import { relative } from "node:path";
import type { Diagnostic, Severity } from "./types.js";

interface SarifRule {
  id: string;
  name: string;
  shortDescription: string;
  helpUri: string;
  defaultLevel: SarifLevel;
}

type SarifLevel = "error" | "warning" | "note";

const HELP_BASE = "https://github.com/erphq/skillcheck#-what-it-checks";

/**
 * Static metadata for every rule skillcheck can emit. Used to populate
 * the SARIF `tool.driver.rules` array so GitHub Code Scanning can show
 * a stable rule catalog with descriptions and severities.
 */
export const RULES: readonly SarifRule[] = [
  {
    id: "parse",
    name: "parse",
    shortDescription:
      "The skill file does not have valid frontmatter / YAML.",
    helpUri: HELP_BASE,
    defaultLevel: "error",
  },
  {
    id: "frontmatter-schema",
    name: "frontmatterSchema",
    shortDescription:
      "Required frontmatter fields are missing or have wrong types.",
    helpUri: HELP_BASE,
    defaultLevel: "error",
  },
  {
    id: "mcp-tool-format",
    name: "mcpToolFormat",
    shortDescription:
      "Tool string starts with 'mcp__' but is not shaped 'mcp__<server>__<tool>'.",
    helpUri: HELP_BASE,
    defaultLevel: "error",
  },
  {
    id: "tool-unknown",
    name: "toolUnknown",
    shortDescription:
      "Tool is not a known Claude Code built-in and is not an MCP tool.",
    helpUri: HELP_BASE,
    defaultLevel: "warning",
  },
  {
    id: "mcp-server-unknown",
    name: "mcpServerUnknown",
    shortDescription:
      "MCP tool references a server not configured in any settings.json.",
    helpUri: HELP_BASE,
    defaultLevel: "warning",
  },
  {
    id: "description-length",
    name: "descriptionLength",
    shortDescription:
      "Description is long enough to dilute the trigger signal.",
    helpUri: HELP_BASE,
    defaultLevel: "warning",
  },
  {
    id: "name-drift",
    name: "nameDrift",
    shortDescription:
      "Frontmatter `name` does not match the filename or directory.",
    helpUri: HELP_BASE,
    defaultLevel: "warning",
  },
  {
    id: "description-collision",
    name: "descriptionCollision",
    shortDescription:
      "Two skills' descriptions overlap on triggers (Jaccard >= 0.6).",
    helpUri: HELP_BASE,
    defaultLevel: "warning",
  },
  {
    id: "tools-overloaded",
    name: "toolsOverloaded",
    shortDescription:
      "tools: lists too many entries; listing everything defeats the purpose of the tools filter.",
    helpUri: HELP_BASE,
    defaultLevel: "warning",
  },
];

const SEVERITY_TO_LEVEL: Record<Severity, SarifLevel> = {
  error: "error",
  warn: "warning",
  info: "note",
};

interface SarifReporterOptions {
  toolVersion: string;
  toolUri?: string;
}

/**
 * Render a SARIF 2.1.0 document for the given diagnostics. The shape
 * follows GitHub Code Scanning's accepted subset.
 */
export function reportSarif(
  diagnostics: Diagnostic[],
  cwd: string,
  opts: SarifReporterOptions,
): string {
  const seenRuleIds = new Set(diagnostics.map((d) => d.rule));
  const rules = RULES.filter((r) => seenRuleIds.has(r.id) || diagnostics.length === 0);

  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));
  const fallbackRules: SarifRule[] = [];
  for (const id of seenRuleIds) {
    if (!ruleIndex.has(id)) {
      const synthetic: SarifRule = {
        id,
        name: id,
        shortDescription: id,
        helpUri: HELP_BASE,
        defaultLevel: "warning",
      };
      fallbackRules.push(synthetic);
      ruleIndex.set(id, rules.length + fallbackRules.length - 1);
    }
  }

  const driver = {
    name: "skillcheck",
    version: opts.toolVersion,
    informationUri: opts.toolUri ?? "https://github.com/erphq/skillcheck",
    rules: [...rules, ...fallbackRules].map((r) => ({
      id: r.id,
      name: r.name,
      shortDescription: { text: r.shortDescription },
      helpUri: r.helpUri,
      defaultConfiguration: { level: r.defaultLevel },
    })),
  };

  const results = diagnostics.map((d) => {
    const result: Record<string, unknown> = {
      ruleId: d.rule,
      ruleIndex: ruleIndex.get(d.rule) ?? 0,
      level: SEVERITY_TO_LEVEL[d.severity],
      message: { text: d.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: relative(cwd, d.file) || d.file,
              uriBaseId: "%SRCROOT%",
            },
            ...(d.line !== undefined
              ? { region: { startLine: d.line } }
              : {}),
          },
        },
      ],
    };
    return result;
  });

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver },
        results,
        columnKind: "utf16CodeUnits",
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
