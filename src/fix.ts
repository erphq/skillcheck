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
 * skipped). Today the supported fix is:
 *
 *   - `name-drift`: rewrite the frontmatter `name:` value to match the
 *     filename (without the .md extension). The directory-name match
 *     is not used as the canonical because skills that live in their
 *     own directory often share a name with siblings.
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
    if (d.rule !== "name-drift") {
      // Only `name-drift` has a safe automated fix today.
      // Other warnings/errors require editorial judgement.
      if (d.severity !== "info") skipped++;
      continue;
    }
    const p = fileToParsed.get(d.file);
    if (!p) {
      skipped++;
      continue;
    }
    const expected = basename(p.file).replace(/\.md$/, "");
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
      `${p.file}: name-drift -> set name to '${expected}' (was in directory '${basename(dirname(p.file))}')`,
    );
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
