import { basename, dirname } from "node:path";
import { SkillFrontmatter } from "./schema.js";
import { isMcpTool, parseMcpToolName } from "./builtins.js";
import type {
  Diagnostic,
  ParsedSkill,
  SkillcheckConfig,
  ValidatedSkill,
} from "./types.js";

const MAX_DESCRIPTION_CHARS = 500;
const COLLISION_THRESHOLD = 0.6;

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

    diagnostics.push(...checkTools(v, config));
    diagnostics.push(...checkDescriptionLength(v));
    diagnostics.push(...checkNameDrift(v));
  }

  diagnostics.push(...checkCollisions(validated));
  return diagnostics;
}

function toValidated(p: ParsedSkill): ValidatedSkill | null {
  const result = SkillFrontmatter.safeParse(p.frontmatter);
  if (!result.success) return null;
  return {
    ...p,
    name: result.data.name,
    description: result.data.description,
    tools: result.data.tools ?? [],
  };
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
    } else if (!config.knownTools.has(tool)) {
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

function checkNameDrift(v: ValidatedSkill): Diagnostic[] {
  const fileBase = basename(v.file).replace(/\.md$/, "");
  const dirBase = basename(dirname(v.file));
  const expected = v.name.toLowerCase();
  if (
    fileBase.toLowerCase() !== expected &&
    dirBase.toLowerCase() !== expected
  ) {
    return [
      {
        severity: "warn",
        rule: "name-drift",
        message: `frontmatter name '${v.name}' does not match filename '${fileBase}' or directory '${dirBase}'`,
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
