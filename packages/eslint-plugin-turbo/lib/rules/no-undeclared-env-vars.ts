import type { Rule } from "eslint";
import path from "path";
import { Node, MemberExpression } from "estree";
import { RULES } from "../constants";
import { Project, getWorkspaceFromFilePath } from "../utils/calculate-inputs";

const meta: Rule.RuleMetaData = {
  type: "problem",
  docs: {
    description:
      "Do not allow the use of `process.env` without including the env key in any turbo.json",
    category: "Configuration Issues",
    recommended: true,
    url: `https://github.com/vercel/turbo/tree/main/packages/eslint-plugin-turbo/docs/rules/${RULES.noUndeclaredEnvVars}.md`,
  },
  schema: [
    {
      type: "object",
      default: {},
      additionalProperties: false,
      properties: {
        // override cwd, primarily exposed for easier testing
        cwd: {
          require: false,
          type: "string",
        },
        allowList: {
          default: [],
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    },
  ],
};

/**
 * Normalize the value of the cwd
 * Extracted from eslint
 * SPDX-License-Identifier: MIT
 */
function normalizeCwd(
  cwd: string | undefined,
  options: Array<any>
): string | undefined {
  if (options?.[0]?.cwd) {
    return options[0].cwd;
  }

  if (cwd) {
    return cwd;
  }
  if (typeof process === "object") {
    return process.cwd();
  }

  return undefined;
}

function create(context: Rule.RuleContext): Rule.RuleListener {
  const { options, getPhysicalFilename } = context;

  const allowList: Array<string> = options?.[0]?.allowList || [];
  const regexAllowList: Array<RegExp> = [];
  allowList.forEach((allowed) => {
    try {
      regexAllowList.push(new RegExp(allowed));
    } catch (err) {
      // log the error, but just move on without this allowList entry
      console.error(`Unable to convert "${allowed}" to regex`);
    }
  });

  const cwd = normalizeCwd(
    context.getCwd ? context.getCwd() : undefined,
    options
  );

  const project = new Project(cwd);
  if (!project.valid()) {
    return {};
  }

  const filePath = getPhysicalFilename();
  const hasWorkspaceConfigs = project.projectWorkspaces.some(
    (workspaceConfig) => !!workspaceConfig.turboConfig
  );
  const workspaceConfig = getWorkspaceFromFilePath(
    project.projectWorkspaces,
    filePath
  );

  const checkKey = (node: Node, envKey?: string) => {
    if (!envKey) {
      return {};
    }

    if (regexAllowList.some((regex) => regex.test(envKey))) {
      return {};
    }

    let configured = project.test(workspaceConfig?.workspaceName, envKey);

    if (configured) {
      return {};
    } else {
      let message = `{{ envKey }} is not listed as a dependency in ${
        hasWorkspaceConfigs ? "root turbo.json" : "turbo.json"
      }`;
      if (workspaceConfig && workspaceConfig.turboConfig) {
        if (cwd) {
          // if we have a cwd, we can provide a relative path to the workspace config
          message = `{{ envKey }} is not listed as a dependency in the root turbo.json or workspace (${path.relative(
            cwd,
            workspaceConfig.workspacePath
          )}) turbo.json`;
        } else {
          message = `{{ envKey }} is not listed as a dependency in the root turbo.json or workspace turbo.json`;
        }
      }

      context.report({
        node,
        message,
        data: { envKey },
      });
    }
  };

  const isComputed = (
    node: MemberExpression & Rule.NodeParentExtension
  ): boolean => {
    if ("computed" in node.parent) {
      return node.parent.computed;
    }

    return false;
  };

  return {
    MemberExpression(node) {
      // we only care about complete process env declarations and non-computed keys
      if (
        "name" in node.object &&
        "name" in node.property &&
        !isComputed(node)
      ) {
        const objectName = node.object.name;
        const propertyName = node.property.name;

        // we're doing something with process.env
        if (objectName === "process" && propertyName === "env") {
          // destructuring from process.env
          if ("id" in node.parent && node.parent.id?.type === "ObjectPattern") {
            const values = node.parent.id.properties.values();
            Array.from(values).forEach((item) => {
              if ("key" in item && "name" in item.key) {
                checkKey(node.parent, item.key.name);
              }
            });
          }

          // accessing key on process.env
          else if (
            "property" in node.parent &&
            "name" in node.parent.property
          ) {
            checkKey(node.parent, node.parent.property?.name);
          }
        }
      }
    },
  };
}

const rule = { create, meta };
export default rule;
