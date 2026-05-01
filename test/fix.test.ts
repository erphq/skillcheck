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
});
