import { writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { Diagnostic, ParsedSkill } from "./types.js";

export interface FixOutcome {
  /** Number of diagnostics that produced an applied fix. */
  fixed: number;
  /** Number of diagnostics whose rule has no safe auto-fix. */
  skipped: number;
  /** Files whose contents were rewritten on disk. */
  filesChanged: string[];
  /** One human-readable line per applied fix, for the report. */
  notes: string[];
}

export interface FixOptions {
  /** When true, do not write to disk; just compute what would happen. */
  dryRun?: boolean;
}

/**
 * Apply safe auto-corrections for the diagnostics we know how to fix.
 *
 * Conservative on purpose: we only auto-fix things that have one obvious
 * answer. Everything else is left for the human (and shows up as
 * skipped). Supported fixes:
 *
 *   - `name-drift`: rewrite the frontmatter `name:` value to match the
 *     parent directory, as required by the Agent Skills package spec.
 *
 *   - `tool-fields-ambiguous`: remove the legacy `tools:` field when
 *     `allowed-tools:` is also present; `allowed-tools:` is the
 *     spec-supported field.
 *
 *   - `name-whitespace`: replace whitespace characters in the frontmatter
 *     `name:` value with hyphens. Hyphens are the conventional word
 *     separator for skill names; spaces make directory matching unreliable.
 *
 *   - `deprecated-tools-field`: rename the legacy `tools:` key to
 *     `allowed-tools:` when only `tools:` is present (no `allowed-tools:`).
 *     The key, its colon, and any trailing whitespace on that line are
 *     rewritten in place; all indented list items are preserved as-is.
 *
 *   - `tools-duplicate`: remove duplicate entries from `allowed-tools:` (string
 *     form) and the legacy `tools:` field (block sequence or string form),
 *     preserving first-occurrence order.
 *
 * Returns a structured outcome so the CLI can report what changed
 * without hand-rolling the same logic.
 */
export async function applyFixes(
  parsed: ParsedSkill[],
  diagnostics: Diagnostic[],
  options: FixOptions = {},
): Promise<FixOutcome> {
  const fileToParsed = new Map<string, ParsedSkill>();
  for (const p of parsed) fileToParsed.set(p.file, p);

  // Buffered per-file contents so multiple fixes on one file compose.
  const buffer = new Map<string, string>();
  const notes: string[] = [];
  let fixed = 0;
  let skipped = 0;

  for (const d of diagnostics) {
    if (d.rule === "name-drift") {
      const p = fileToParsed.get(d.file);
      if (!p) {
        skipped++;
        continue;
      }
      const expected = basename(dirname(p.file));
      const current = buffer.get(p.file) ?? p.raw;
      const next = rewriteFrontmatterName(current, expected);
      if (next === current) {
        // Either the name field is missing or already correct - either
        // way, nothing safe to do here.
        skipped++;
        continue;
      }
      buffer.set(p.file, next);
      fixed++;
      notes.push(
        `${p.file}: name-drift -> set name to '${expected}' (parent directory)`,
      );
    } else if (d.rule === "tool-fields-ambiguous") {
      const p = fileToParsed.get(d.file);
      if (!p) {
        skipped++;
        continue;
      }
      const current = buffer.get(p.file) ?? p.raw;
      const next = rewriteFrontmatterRemoveLegacyTools(current);
      if (next === current) {
        skipped++;
        continue;
      }
      buffer.set(p.file, next);
      fixed++;
      notes.push(
        `${p.file}: tool-fields-ambiguous -> removed legacy tools: field (prefer allowed-tools:)`,
      );
    } else if (d.rule === "name-whitespace") {
      const p = fileToParsed.get(d.file);
      if (!p) {
        skipped++;
        continue;
      }
      const current = buffer.get(p.file) ?? p.raw;
      const next = rewriteFrontmatterNameReplaceWhitespace(current);
      if (next === current) {
        skipped++;
        continue;
      }
      buffer.set(p.file, next);
      fixed++;
      notes.push(
        `${p.file}: name-whitespace -> replaced whitespace in name with hyphens`,
      );
    } else if (d.rule === "deprecated-tools-field") {
      const p = fileToParsed.get(d.file);
      if (!p) {
        skipped++;
        continue;
      }
      const current = buffer.get(p.file) ?? p.raw;
      const next = rewriteFrontmatterRenameToolsToAllowedTools(current);
      if (next === current) {
        skipped++;
        continue;
      }
      buffer.set(p.file, next);
      fixed++;
      notes.push(
        `${p.file}: deprecated-tools-field -> renamed tools: to allowed-tools:`,
      );
    } else if (d.rule === "tools-duplicate") {
      const p = fileToParsed.get(d.file);
      if (!p) {
        skipped++;
        continue;
      }
      const current = buffer.get(p.file) ?? p.raw;
      const next = rewriteDeduplicateTools(current);
      if (next === current) {
        skipped++;
        continue;
      }
      buffer.set(p.file, next);
      fixed++;
      notes.push(`${p.file}: tools-duplicate -> removed duplicate tool entries`);
    } else {
      // Only the rules above have safe automated fixes today. Other
      // warnings/errors require editorial judgement.
      if (d.severity !== "info") skipped++;
    }
  }

  const filesChanged = Array.from(buffer.keys());
  if (!options.dryRun) {
    for (const [file, contents] of buffer) {
      await writeFile(file, contents, "utf8");
    }
  }
  return { fixed, skipped, filesChanged, notes };
}

/**
 * Rewrite the `name:` line inside the YAML frontmatter to `value`.
 * Returns the input unchanged if no frontmatter or no `name:` line is
 * present (we don't *insert* a missing key - that's not a safe fix).
 */
function rewriteFrontmatterName(raw: string, value: string): string {
  // Parse out the frontmatter block by hand (instead of round-tripping
  // through a YAML library) to preserve the user's formatting,
  // comments, and key order.
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return raw;
  const block = fmMatch[1] ?? "";
  const lineRe = /^(\s*name\s*:\s*)(.*)$/m;
  if (!lineRe.test(block)) return raw;
  const newBlock = block.replace(lineRe, (_m, prefix: string) => {
    return `${prefix}${value}`;
  });
  if (newBlock === block) return raw;
  return raw.replace(fmMatch[0], `---\n${newBlock}\n---\n`);
}

/**
 * Replace whitespace characters in the frontmatter `name:` value with
 * hyphens. Runs of whitespace collapse to a single hyphen. Returns the
 * input unchanged if no frontmatter, no `name:` line, or the name
 * already contains no whitespace.
 */
function rewriteFrontmatterNameReplaceWhitespace(raw: string): string {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return raw;
  const block = fmMatch[1] ?? "";
  const lineRe = /^(\s*name\s*:\s*)(.*)$/m;
  const m = block.match(lineRe);
  if (!m) return raw;
  const currentName = m[2] ?? "";
  if (!/\s/.test(currentName)) return raw;
  const fixedName = currentName.trim().replace(/\s+/g, "-");
  const newBlock = block.replace(lineRe, (_match, prefix: string) => `${prefix}${fixedName}`);
  if (newBlock === block) return raw;
  return raw.replace(fmMatch[0], `---\n${newBlock}\n---\n`);
}

/**
 * Remove the legacy `tools:` field from the YAML frontmatter.
 * Called when `allowed-tools:` is also present (`tool-fields-ambiguous`
 * diagnostic). Returns the input unchanged if no frontmatter or no
 * `tools:` field is found.
 */
function rewriteFrontmatterRemoveLegacyTools(raw: string): string {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return raw;
  const block = fmMatch[1] ?? "";
  // Match the `tools:` line and any following indented block-sequence
  // lines (e.g. `  - Read`). Handles both inline (tools: [a, b]) and
  // block (tools:\n  - a\n  - b) YAML forms.
  const toolsRe = /^[ \t]*tools[ \t]*:[^\r\n]*(?:\r?\n[ \t]+-[^\r\n]*)*/m;
  if (!toolsRe.test(block)) return raw;
  const newBlock = block
    .replace(toolsRe, "")
    .replace(/(?:\r?\n){2,}/g, "\n")
    .replace(/^\n/, "");
  if (newBlock === block) return raw;
  return raw.replace(fmMatch[0], `---\n${newBlock}\n---\n`);
}

/**
 * Remove duplicate tool entries from `allowed-tools:` and the legacy `tools:`
 * field. Handles:
 *   - `allowed-tools:` as an unquoted space- or comma-separated string.
 *   - `tools:` as a YAML block sequence (`- item` lines).
 *   - `tools:` as an unquoted space- or comma-separated string.
 * Quoted string values and other forms are left unchanged (no safe parse).
 */
function rewriteDeduplicateTools(raw: string): string {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return raw;
  const block = fmMatch[1] ?? "";
  let newBlock = block;

  // allowed-tools is always a string per schema; handle unquoted inline form.
  newBlock = deduplicateToolsStringLine(newBlock, "allowed-tools");
  // tools (legacy) may be a block sequence or an unquoted string.
  newBlock = deduplicateToolsBlockSequence(newBlock, "tools");
  newBlock = deduplicateToolsStringLine(newBlock, "tools");

  if (newBlock === block) return raw;
  return raw.replace(fmMatch[0], `---\n${newBlock}\n---\n`);
}

function splitAllowlistString(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if ((ch === "," || /\s/.test(ch)) && depth === 0) {
      const t = current.trim();
      if (t) out.push(t);
      current = "";
      continue;
    }
    current += ch;
  }
  const t = current.trim();
  if (t) out.push(t);
  return out;
}

function deduplicatePreserveOrder(tools: string[]): string[] {
  const seen = new Set<string>();
  return tools.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/**
 * Deduplicate an unquoted space- or comma-separated tool list on a single
 * YAML line. Quoted values are left unchanged (safe-parse is not feasible).
 */
function deduplicateToolsStringLine(block: string, field: string): string {
  const re = new RegExp(`^([ \\t]*${field}[ \\t]*:[ \\t]*)([^\\[\\r\\n].*)$`, "m");
  const m = block.match(re);
  if (!m) return block;
  const prefix = m[1] ?? "";
  const valueRaw = (m[2] ?? "").trim();
  if (!valueRaw || valueRaw.startsWith('"') || valueRaw.startsWith("'")) return block;
  const tools = splitAllowlistString(valueRaw);
  const deduped = deduplicatePreserveOrder(tools);
  if (deduped.length === tools.length) return block;
  const sep = valueRaw.includes(",") ? ", " : " ";
  return block.replace(re, `${prefix}${deduped.join(sep)}`);
}

/**
 * Deduplicate items in a YAML block sequence under `field`. Processes only
 * contiguous `  - item` lines immediately following the key line; stops at
 * any non-sequence line (blank line, comment, next key).
 */
function deduplicateToolsBlockSequence(block: string, field: string): string {
  const headRe = new RegExp(`(^[ \\t]*${field}[ \\t]*:[ \\t]*)(\\r?\\n)`, "m");
  const headMatch = block.match(headRe);
  if (!headMatch || headMatch.index === undefined) return block;

  const afterHead = headMatch.index + headMatch[0].length;
  let pos = afterHead;
  const seen = new Set<string>();
  let changed = false;
  const kept: string[] = [];

  while (pos < block.length) {
    const remaining = block.slice(pos);
    const lineMatch = remaining.match(/^([ \t]+-[ \t]*)([^\r\n]*)(\r?\n|$)/);
    if (!lineMatch) break;
    const itemIndent = lineMatch[1] ?? "";
    const item = (lineMatch[2] ?? "").trim();
    const eol = lineMatch[3] ?? "";
    if (seen.has(item)) {
      changed = true;
    } else {
      seen.add(item);
      kept.push(`${itemIndent}${item}${eol}`);
    }
    pos += lineMatch[0].length;
  }

  if (!changed) return block;
  return block.slice(0, afterHead) + kept.join("") + block.slice(pos);
}

/**
 * Rename the `tools:` key to `allowed-tools:` in the YAML frontmatter.
 * Called when only the legacy `tools:` field is present (`deprecated-tools-field`
 * diagnostic). The key is replaced in-place so all list items and
 * surrounding formatting are preserved. Returns the input unchanged if no
 * frontmatter or no `tools:` line is found.
 */
function rewriteFrontmatterRenameToolsToAllowedTools(raw: string): string {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return raw;
  const block = fmMatch[1] ?? "";
  // Match only the `tools:` key line itself; leave indented list items alone.
  const toolsKeyRe = /^([ \t]*)tools([ \t]*:)/m;
  if (!toolsKeyRe.test(block)) return raw;
  const newBlock = block.replace(toolsKeyRe, "$1allowed-tools$2");
  if (newBlock === block) return raw;
  return raw.replace(fmMatch[0], `---\n${newBlock}\n---\n`);
}
