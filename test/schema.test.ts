import { describe, expect, it } from "vitest";

import { SkillFrontmatter } from "../src/schema.js";

// `SkillFrontmatter` is the boundary at which untrusted YAML
// frontmatter becomes typed input for every check. The transform
// on `tools` is the part that's most likely to drift silently —
// it accepts both an array and a comma-separated string for
// backwards compatibility.

describe("SkillFrontmatter — required fields", () => {
  it("accepts a minimal valid frontmatter", () => {
    const out = SkillFrontmatter.parse({
      name: "my-skill",
      description: "does the thing",
    });
    expect(out.name).toBe("my-skill");
    expect(out.description).toBe("does the thing");
    expect(out.tools).toBeUndefined();
    expect(out.model).toBeUndefined();
  });

  it("rejects empty name", () => {
    expect(() =>
      SkillFrontmatter.parse({ name: "", description: "x" }),
    ).toThrow(/name/);
  });

  it("rejects empty description", () => {
    expect(() =>
      SkillFrontmatter.parse({ name: "x", description: "" }),
    ).toThrow(/description/);
  });

  it("rejects missing name", () => {
    expect(() => SkillFrontmatter.parse({ description: "x" })).toThrow();
  });

  it("rejects missing description", () => {
    expect(() => SkillFrontmatter.parse({ name: "x" })).toThrow();
  });
});

describe("SkillFrontmatter — tools transform", () => {
  it("accepts an array of strings as-is", () => {
    const out = SkillFrontmatter.parse({
      name: "x",
      description: "x",
      tools: ["read", "write"],
    });
    expect(out.tools).toEqual(["read", "write"]);
  });

  it("splits a comma-separated string into an array", () => {
    // Backwards-compat: older skills wrote `tools: read,write` as
    // a single string. The transform must split on commas.
    const out = SkillFrontmatter.parse({
      name: "x",
      description: "x",
      tools: "read,write,bash",
    });
    expect(out.tools).toEqual(["read", "write", "bash"]);
  });

  it("trims whitespace around comma-split tool names", () => {
    // YAML serialisers often emit `tools: read, write, bash` with
    // spaces; without trimming, the names would be " write" and
    // " bash" and silently fail to match the BUILTIN_TOOLS set.
    const out = SkillFrontmatter.parse({
      name: "x",
      description: "x",
      tools: "read, write , bash",
    });
    expect(out.tools).toEqual(["read", "write", "bash"]);
  });

  it("drops empty entries from a comma-separated string", () => {
    // `tools: read,,write` shouldn't produce a phantom "" entry.
    const out = SkillFrontmatter.parse({
      name: "x",
      description: "x",
      tools: "read,,write,",
    });
    expect(out.tools).toEqual(["read", "write"]);
  });

  it("preserves array entries verbatim (no trim)", () => {
    // When the author explicitly wrote a YAML array, we treat each
    // entry as authoritative — leading/trailing whitespace there
    // is the author's choice and we don't second-guess it.
    const out = SkillFrontmatter.parse({
      name: "x",
      description: "x",
      tools: ["read"],
    });
    expect(out.tools).toEqual(["read"]);
  });

  it("leaves tools undefined when omitted", () => {
    const out = SkillFrontmatter.parse({ name: "x", description: "x" });
    expect(out.tools).toBeUndefined();
  });
});

describe("SkillFrontmatter — passthrough", () => {
  it("preserves unknown fields (passthrough mode)", () => {
    // Skills frequently carry custom keys (e.g. `triggers`,
    // `version`); the schema is intentionally permissive on
    // unknown keys so a future field addition by Claude Code
    // doesn't break every skill on the linter.
    const out = SkillFrontmatter.parse({
      name: "x",
      description: "x",
      version: "1.2.3",
      custom_field: { nested: true },
    });
    expect((out as { version?: unknown }).version).toBe("1.2.3");
    expect((out as { custom_field?: unknown }).custom_field).toEqual({
      nested: true,
    });
  });
});
