import { describe, it, expect } from "vitest";
import { parseSkillContent, ParseError } from "../src/parse.js";

describe("parseSkillContent", () => {
  it("parses well-formed frontmatter", () => {
    const raw = `---
name: foo
description: do the foo thing
---

Body here.
`;
    const p = parseSkillContent("foo.md", raw);
    expect(p.frontmatter).toEqual({
      name: "foo",
      description: "do the foo thing",
    });
    expect(p.body.trim()).toBe("Body here.");
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseSkillContent("x.md", "no frontmatter\n")).toThrow(
      ParseError,
    );
  });

  it("throws when YAML is not a mapping", () => {
    const raw = "---\n- just\n- a\n- list\n---\nbody\n";
    expect(() => parseSkillContent("x.md", raw)).toThrow(ParseError);
  });

  it("preserves CRLF input", () => {
    const raw = "---\r\nname: foo\r\ndescription: bar\r\n---\r\nbody\r\n";
    const p = parseSkillContent("x.md", raw);
    expect(p.frontmatter).toEqual({ name: "foo", description: "bar" });
  });
});
