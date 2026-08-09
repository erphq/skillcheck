import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes } from "../src/fix.js";
import { parseSkillFile } from "../src/parse.js";

let tmp = "";

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "skillcheck-compose-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeSkill(rel: string, contents: string): Promise<string> {
  const path = join(tmp, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
  return path;
}

// These tests exercise the per-file buffer inside applyFixes.
// When two diagnostics target the same file, the second fix must
// operate on the output of the first, not on the original raw content.
describe("applyFixes - composing fixes on one file", () => {
  it("applies name-drift and deprecated-tools-field to the same file in one call", async () => {
    const file = await writeSkill(
      "deployer/SKILL.md",
      `---\nname: wrong\ndescription: deploy services reliably\ntools:\n  - Bash\n  - Read\n---\nbody\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [
        { severity: "warn", rule: "name-drift", message: "", file },
        { severity: "warn", rule: "deprecated-tools-field", message: "", file },
      ],
    );
    expect(outcome.fixed).toBe(2);
    expect(outcome.skipped).toBe(0);
    expect(outcome.filesChanged).toEqual([file]);
    const written = await readFile(file, "utf8");
    expect(written).toContain("name: deployer");
    expect(written).toContain("allowed-tools:");
    expect(written).toContain("  - Bash");
    expect(written).not.toContain("name: wrong");
    expect(written).not.toMatch(/^tools[ \t]*:/m);
  });

  it("applies tool-fields-ambiguous then tools-duplicate on the same file in one call", async () => {
    const file = await writeSkill(
      "myskill/SKILL.md",
      `---\nname: myskill\ndescription: do the thing properly here\ntools:\n  - Read\nallowed-tools: Read Bash Read\n---\nbody\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [
        { severity: "warn", rule: "tool-fields-ambiguous", message: "", file },
        { severity: "warn", rule: "tools-duplicate", message: "", file },
      ],
    );
    expect(outcome.fixed).toBe(2);
    expect(outcome.skipped).toBe(0);
    expect(outcome.filesChanged).toEqual([file]);
    const written = await readFile(file, "utf8");
    expect(written).not.toMatch(/^tools[ \t]*:/m);
    expect(written).toContain("allowed-tools:");
    expect(written).not.toMatch(/Read Bash Read/);
  });

  it("fixes two files in one call, each with two different rules", async () => {
    const f1 = await writeSkill(
      "alpha/SKILL.md",
      `---\nname: wrong\ndescription: do alpha things well\ntools:\n  - Read\n---\nbody\n`,
    );
    const f2 = await writeSkill(
      "beta/SKILL.md",
      `---\nname: wrong\ndescription: do beta things well\ntools:\n  - Bash\n---\nbody\n`,
    );
    const [p1, p2] = await Promise.all([parseSkillFile(f1), parseSkillFile(f2)]);
    const outcome = await applyFixes(
      [p1, p2],
      [
        { severity: "warn", rule: "name-drift", message: "", file: f1 },
        { severity: "warn", rule: "deprecated-tools-field", message: "", file: f1 },
        { severity: "warn", rule: "name-drift", message: "", file: f2 },
        { severity: "warn", rule: "deprecated-tools-field", message: "", file: f2 },
      ],
    );
    expect(outcome.fixed).toBe(4);
    expect(outcome.filesChanged).toHaveLength(2);
    const [c1, c2] = await Promise.all([readFile(f1, "utf8"), readFile(f2, "utf8")]);
    expect(c1).toContain("name: alpha");
    expect(c1).toContain("allowed-tools:");
    expect(c2).toContain("name: beta");
    expect(c2).toContain("allowed-tools:");
  });

  it("notes array has one entry per applied fix when composing on the same file", async () => {
    const file = await writeSkill(
      "deployer/SKILL.md",
      `---\nname: wrong\ndescription: deploy services reliably\ntools:\n  - Bash\n---\nbody\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [
        { severity: "warn", rule: "name-drift", message: "", file },
        { severity: "warn", rule: "deprecated-tools-field", message: "", file },
      ],
    );
    expect(outcome.notes).toHaveLength(2);
    expect(outcome.notes.some((n) => n.includes("name-drift"))).toBe(true);
    expect(outcome.notes.some((n) => n.includes("deprecated-tools-field"))).toBe(true);
  });

  it("counts skipped when a diagnostic file path is not in the parsed list", async () => {
    const file = await writeSkill(
      "myskill/SKILL.md",
      `---\nname: myskill\ndescription: do the thing properly\n---\nbody\n`,
    );
    const parsed = await parseSkillFile(file);
    const ghostFile = join(tmp, "ghost/SKILL.md");
    const outcome = await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file: ghostFile }],
    );
    expect(outcome.fixed).toBe(0);
    expect(outcome.skipped).toBe(1);
    expect(outcome.filesChanged).toEqual([]);
  });

  it("compose: dry run does not write any changes to disk", async () => {
    const original = `---\nname: wrong\ndescription: deploy services reliably\ntools:\n  - Bash\n---\nbody\n`;
    const file = await writeSkill("deployer/SKILL.md", original);
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [
        { severity: "warn", rule: "name-drift", message: "", file },
        { severity: "warn", rule: "deprecated-tools-field", message: "", file },
      ],
      { dryRun: true },
    );
    expect(outcome.fixed).toBe(2);
    expect(outcome.filesChanged).toEqual([file]);
    const written = await readFile(file, "utf8");
    expect(written).toBe(original);
  });
});
