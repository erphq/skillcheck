import { basename, dirname } from "node:path";
import { SkillFrontmatter } from "./schema.js";
import { isMcpTool, parseMcpToolName } from "./builtins.js";
import type {
  Diagnostic,
  ParsedSkill,
  SkillcheckConfig,
  ValidatedSkill,
} from "./types.js";

const MIN_DESCRIPTION_CHARS = 10;
const MAX_DESCRIPTION_CHARS = 500;
const COLLISION_THRESHOLD = 0.6;
const MAX_TOOLS_COUNT = 10;

// Known Claude model IDs. Severity is warn (not error) because the list
// evolves with each Anthropic release; update this set when new models ship.
const KNOWN_CLAUDE_MODELS: ReadonlySet<string> = new Set([
  "claude-3-haiku-20240307",
  "claude-3-opus-20240229",
  "claude-3-opus-latest",
  "claude-3-sonnet-20240229",
  "claude-3-5-haiku-20241022",
  "claude-3-5-haiku-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
]);

export function runChecks(
  parsed: ParsedSkill[],
  config: SkillcheckConfig,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const validated: ValidatedSkill[] = [];

  for (const p of parsed) {
    const fmDiag = checkFrontmatter(p);
    diagnostics.push(...fmDiag);
    if (fmDiag.some((d) => d.severity === "error")) continue;

    const v = toValidated(p);
    if (!v) continue;
    validated.push(v);

    diagnostics.push(...checkSkillFileName(v));
    diagnostics.push(...checkToolFieldsAmbiguous(v));
    diagnostics.push(...checkTools(v, config));
    diagnostics.push(...checkToolsOverloaded(v));
    diagnostics.push(...checkDescriptionLength(v));
    diagnostics.push(...checkDescriptionTooShort(v));
    diagnostics.push(...checkNameDrift(v));
    diagnostics.push(...checkNameWhitespace(v));
    diagnostics.push(...checkEmptyBody(v));
    diagnostics.push(...checkModelUnknown(v));
  }

  diagnostics.push(...checkCollisions(validated));
  diagnostics.push(...checkDuplicateNames(validated));
  return diagnostics;
}

function toValidated(p: ParsedSkill): ValidatedSkill | null {
  const result = SkillFrontmatter.safeParse(p.frontmatter);
  if (!result.success) return null;
  return {
    ...p,
    name: result.data.name,
    description: result.data.description,
    tools: combineTools(result.data.tools ?? [], result.data["allowed-tools"] ?? []),
  };
}

function combineTools(...groups: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const tool of group) {
      if (seen.has(tool)) continue;
      seen.add(tool);
      out.push(tool);
    }
  }
  return out;
}

function checkFrontmatter(p: ParsedSkill): Diagnostic[] {
  const result = SkillFrontmatter.safeParse(p.frontmatter);
  if (result.success) return [];
  return result.error.issues.map(
    (iss): Diagnostic => ({
      severity: "error",
      rule: "frontmatter-schema",
      message: `${iss.path.join(".") || "<root>"}: ${iss.message}`,
      file: p.file,
    }),
  );
}

function checkSkillFileName(v: ValidatedSkill): Diagnostic[] {
  if (basename(v.file) === "SKILL.md") return [];
  return [
    {
      severity: "warn",
      rule: "skill-file-name",
      message:
        "skill file is not named SKILL.md; Agent Skills packages are directories containing a SKILL.md file",
      file: v.file,
    },
  ];
}

function checkToolFieldsAmbiguous(v: ValidatedSkill): Diagnostic[] {
  if (
    v.frontmatter.tools !== undefined &&
    v.frontmatter["allowed-tools"] !== undefined
  ) {
    return [
      {
        severity: "warn",
        rule: "tool-fields-ambiguous",
        message:
          "both tools: and allowed-tools: are present; prefer allowed-tools and remove tools to avoid ambiguous tool declarations",
        file: v.file,
      },
    ];
  }
  return [];
}

function checkTools(v: ValidatedSkill, config: SkillcheckConfig): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const tool of v.tools) {
    if (isMcpTool(tool)) {
      const ref = parseMcpToolName(tool);
      if (!ref) {
        out.push({
          severity: "error",
          rule: "mcp-tool-format",
          message: `tool '${tool}' looks like an MCP tool but has the wrong shape (expected mcp__<server>__<tool>)`,
          file: v.file,
        });
        continue;
      }
      if (config.mcpServers.size > 0 && !config.mcpServers.has(ref.server)) {
        out.push({
          severity: "warn",
          rule: "mcp-server-unknown",
          message: `tool '${tool}' references MCP server '${ref.server}', not found in any settings.json mcpServers`,
          file: v.file,
        });
      }
    } else if (!config.knownTools.has(builtinToolName(tool))) {
      out.push({
        severity: "warn",
        rule: "tool-unknown",
        message: `tool '${tool}' is not a known built-in Claude Code tool`,
        file: v.file,
      });
    }
  }
  return out;
}

function builtinToolName(tool: string): string {
  const match = tool.match(/^([A-Za-z][A-Za-z0-9]*)(?:\([^)]*\))?$/);
  return match?.[1] ?? tool;
}

function checkToolsOverloaded(v: ValidatedSkill): Diagnostic[] {
  if (v.tools.length >= MAX_TOOLS_COUNT) {
    return [
      {
        severity: "warn",
        rule: "tools-overloaded",
        message: `tool allowlist lists ${v.tools.length} tools; narrow the list to the tools this skill actually needs`,
        file: v.file,
      },
    ];
  }
  return [];
}

function checkDescriptionLength(v: ValidatedSkill): Diagnostic[] {
  if (v.description.length > MAX_DESCRIPTION_CHARS) {
    return [
      {
        severity: "warn",
        rule: "description-length",
        message: `description is ${v.description.length} chars (>${MAX_DESCRIPTION_CHARS}); long descriptions dilute the trigger signal`,
        file: v.file,
      },
    ];
  }
  return [];
}

function checkDescriptionTooShort(v: ValidatedSkill): Diagnostic[] {
  if (v.description.length < MIN_DESCRIPTION_CHARS) {
    return [
      {
        severity: "warn",
        rule: "description-too-short",
        message: `description is ${v.description.length} chars (<${MIN_DESCRIPTION_CHARS}); too brief to give Claude a reliable trigger signal`,
        file: v.file,
      },
    ];
  }
  return [];
}

function checkNameDrift(v: ValidatedSkill): Diagnostic[] {
  const dirBase = basename(dirname(v.file));
  const nameLower = v.name.toLowerCase();
  const dirLower = dirBase.toLowerCase();

  if (dirLower === nameLower) return [];

  return [
    {
      severity: "warn",
      rule: "name-drift",
      message: `frontmatter name '${v.name}' does not match parent directory '${dirBase}'`,
      file: v.file,
    },
  ];
}

function checkNameWhitespace(v: ValidatedSkill): Diagnostic[] {
  if (/\s/.test(v.name)) {
    return [
      {
        severity: "warn",
        rule: "name-whitespace",
        message: `skill name '${v.name}' contains whitespace; use hyphens or underscores as word separators`,
        file: v.file,
      },
    ];
  }
  return [];
}

function checkModelUnknown(v: ValidatedSkill): Diagnostic[] {
  const model = v.frontmatter.model;
  if (model === undefined) return [];
  if (typeof model !== "string" || model.length === 0) return [];
  if (KNOWN_CLAUDE_MODELS.has(model)) return [];
  return [
    {
      severity: "warn",
      rule: "model-unknown",
      message: `model '${model}' is not a recognized Claude model; check for typos or update skillcheck`,
      file: v.file,
    },
  ];
}

function checkEmptyBody(v: ValidatedSkill): Diagnostic[] {
  if (v.body.trim().length === 0) {
    return [
      {
        severity: "warn",
        rule: "empty-body",
        message: "skill body is empty; add instructions for Claude to follow",
        file: v.file,
      },
    ];
  }
  return [];
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function checkCollisions(skills: ValidatedSkill[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const tokens = skills.map((s) => ({
    skill: s,
    tokens: tokenize(s.description),
  }));
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const ti = tokens[i];
      const tj = tokens[j];
      if (!ti || !tj) continue;
      const score = jaccard(ti.tokens, tj.tokens);
      if (score >= COLLISION_THRESHOLD) {
        out.push({
          severity: "warn",
          rule: "description-collision",
          message: `description overlaps with '${tj.skill.name}' (Jaccard ${score.toFixed(2)})`,
          file: ti.skill.file,
        });
        out.push({
          severity: "warn",
          rule: "description-collision",
          message: `description overlaps with '${ti.skill.name}' (Jaccard ${score.toFixed(2)})`,
          file: tj.skill.file,
        });
      }
    }
  }
  return out;
}

function checkDuplicateNames(skills: ValidatedSkill[]): Diagnostic[] {
  const byName = new Map<string, ValidatedSkill[]>();
  for (const s of skills) {
    const key = s.name.toLowerCase();
    const group = byName.get(key) ?? [];
    group.push(s);
    byName.set(key, group);
  }
  const out: Diagnostic[] = [];
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const s of group) {
      const others = group
        .filter((g) => g.file !== s.file)
        .map((g) => `'${g.file}'`)
        .join(", ");
      out.push({
        severity: "warn",
        rule: "duplicate-name",
        message: `skill name '${s.name}' is also declared in ${others}`,
        file: s.file,
      });
    }
  }
  return out;
}
