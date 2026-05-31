import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFixes } from "../src/fix.js";
import { parseSkillFile } from "../src/parse.js";

let tmp = "";

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "skillcheck-fix-"));
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

describe("applyFixes", () => {
  it("rewrites frontmatter name to match the filename", async () => {
    const file = await writeSkill(
      "summarizer.md",
      `---\nname: summariser\ndescription: x\n---\nbody\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [
        {
          severity: "warn",
          rule: "name-drift",
          message: "x",
          file,
        },
      ],
    );
    expect(outcome.fixed).toBe(1);
    expect(outcome.skipped).toBe(0);
    expect(outcome.filesChanged).toEqual([file]);
    const written = await readFile(file, "utf8");
    expect(written).toContain("name: summarizer");
    expect(written).not.toContain("name: summariser");
  });

  it("dry run does not write to disk", async () => {
    const file = await writeSkill(
      "summarizer.md",
      `---\nname: summariser\ndescription: x\n---\nbody\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file }],
      { dryRun: true },
    );
    expect(outcome.fixed).toBe(1);
    expect(outcome.filesChanged).toEqual([file]);
    const written = await readFile(file, "utf8");
    // unchanged on disk
    expect(written).toContain("name: summariser");
  });

  it("skips diagnostics whose rule has no safe auto-fix", async () => {
    const file = await writeSkill(
      "x.md",
      `---\nname: x\ndescription: too long\n---\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [
        {
          severity: "warn",
          rule: "description-collision",
          message: "",
          file,
        },
        { severity: "warn", rule: "tool-unknown", message: "", file },
      ],
    );
    expect(outcome.fixed).toBe(0);
    expect(outcome.skipped).toBe(2);
    expect(outcome.filesChanged).toEqual([]);
  });

  it("preserves user formatting outside the name field", async () => {
    const original = `---\n# author: alice\ndescription: x\nname:   summariser\nallowed-tools:\n  - Read\n---\nhello\n`;
    const file = await writeSkill("summarizer.md", original);
    const parsed = await parseSkillFile(file);
    await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file }],
    );
    const written = await readFile(file, "utf8");
    expect(written).toContain("# author: alice");
    expect(written).toContain("allowed-tools:\n  - Read");
    expect(written).toContain("name:   summarizer");
  });

  it("does not rewrite when name field is absent (no safe insert)", async () => {
    const original = `---\ndescription: x\n---\nbody\n`;
    const file = await writeSkill("summarizer.md", original);
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file }],
    );
    expect(outcome.fixed).toBe(0);
    expect(outcome.skipped).toBe(1);
    const written = await readFile(file, "utf8");
    expect(written).toBe(original);
  });

  it("populates notes with a human-readable description for each applied fix", async () => {
    const file = await writeSkill(
      "summarizer.md",
      `---\nname: summariser\ndescription: x\n---\nbody\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file }],
    );
    expect(outcome.notes).toHaveLength(1);
    expect(outcome.notes[0]).toContain("name-drift");
    expect(outcome.notes[0]).toContain("summarizer");
  });

  it("does not count info-severity diagnostics as skipped", async () => {
    const file = await writeSkill(
      "x.md",
      `---\nname: x\ndescription: y\n---\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [{ severity: "info", rule: "some-info-rule", message: "", file }],
    );
    expect(outcome.fixed).toBe(0);
    expect(outcome.skipped).toBe(0);
    expect(outcome.filesChanged).toEqual([]);
  });

  it("fixes name-drift across multiple files in a single call", async () => {
    const f1 = await writeSkill(
      "alpha.md",
      `---\nname: wrong\ndescription: x\n---\nbody\n`,
    );
    const f2 = await writeSkill(
      "beta.md",
      `---\nname: wrong\ndescription: y\n---\nbody\n`,
    );
    const [p1, p2] = await Promise.all([
      parseSkillFile(f1),
      parseSkillFile(f2),
    ]);
    const outcome = await applyFixes(
      [p1, p2],
      [
        { severity: "warn", rule: "name-drift", message: "", file: f1 },
        { severity: "warn", rule: "name-drift", message: "", file: f2 },
      ],
    );
    expect(outcome.fixed).toBe(2);
    expect(outcome.filesChanged).toHaveLength(2);
    const [c1, c2] = await Promise.all([
      readFile(f1, "utf8"),
      readFile(f2, "utf8"),
    ]);
    expect(c1).toContain("name: alpha");
    expect(c2).toContain("name: beta");
  });

  it("fixes name-drift on a file with CRLF line endings", async () => {
    const file = await writeSkill(
      "myskill.md",
      `---\r\nname: wrongname\r\ndescription: x\r\n---\r\nbody\r\n`,
    );
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file }],
    );
    expect(outcome.fixed).toBe(1);
    const written = await readFile(file, "utf8");
    expect(written).toContain("name: myskill");
    expect(written).not.toContain("name: wrongname");
  });

  it("preserves body line endings after fixing CRLF frontmatter", async () => {
    const file = await writeSkill(
      "myskill.md",
      `---\r\nname: wrongname\r\ndescription: x\r\n---\r\nline one\r\nline two\r\n`,
    );
    const parsed = await parseSkillFile(file);
    await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file }],
    );
    const written = await readFile(file, "utf8");
    expect(written).toContain("line one\r\n");
    expect(written).toContain("line two\r\n");
  });

  it("skips a CRLF file when the name field is absent", async () => {
    const original = `---\r\ndescription: x\r\n---\r\nbody\r\n`;
    const file = await writeSkill("myskill.md", original);
    const parsed = await parseSkillFile(file);
    const outcome = await applyFixes(
      [parsed],
      [{ severity: "warn", rule: "name-drift", message: "", file }],
    );
    expect(outcome.fixed).toBe(0);
    expect(outcome.skipped).toBe(1);
    const written = await readFile(file, "utf8");
    expect(written).toBe(original);
  });
});
