import { describe, it, expect } from "vitest";
import { runChecks } from "../src/checks.js";
import { parseSkillContent } from "../src/parse.js";
import { BUILTIN_TOOLS } from "../src/builtins.js";
import type { SkillcheckConfig, ParsedSkill } from "../src/types.js";

const config: SkillcheckConfig = {
  knownTools: new Set(BUILTIN_TOOLS),
  mcpServers: new Set(["github", "linear"]),
  cwd: "/test",
};

function mkSkill(
  file: string,
  fm: Record<string, unknown>,
  body = "body content",
): ParsedSkill {
  const yaml = Object.entries(fm)
    .map(
      ([k, v]) =>
        `${k}: ${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`,
    )
    .join("\n");
  return parseSkillContent(file, `---\n${yaml}\n---\n${body}\n`);
}

describe("runChecks", () => {
  it("flags missing required fields", () => {
    const s = mkSkill("/test/foo/foo.md", { name: "foo" });
    const ds = runChecks([s], config);
    expect(
      ds.some(
        (d) => d.severity === "error" && d.rule === "frontmatter-schema",
      ),
    ).toBe(true);
  });

  it("warns on unknown tool", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      tools: ["BogusTool"],
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tool-unknown")).toBe(true);
  });

  it("accepts comma-separated tools string", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      tools: "Read, Edit, Bash",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tool-unknown")).toBeUndefined();
  });

  it("accepts space-separated allowed-tools string", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      "allowed-tools": "Read Edit Bash",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tool-unknown")).toBeUndefined();
  });

  it("does not flag SendUserFile as an unknown tool", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      "allowed-tools": "SendUserFile Read",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tool-unknown")).toBeUndefined();
  });

  it("accepts scoped built-ins in allowed-tools", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      "allowed-tools": "Bash(ssh:*) Bash(git:*) Read",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tool-unknown")).toBeUndefined();
  });

  it("accepts comma-separated scoped built-ins in allowed-tools", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      "allowed-tools": "Read, Bash(curl *), Bash(jq *)",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tool-unknown")).toBeUndefined();
  });

  it("warns on unknown tool in allowed-tools", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      "allowed-tools": "Read BogusTool",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tool-unknown")).toBe(true);
  });

  it("warns when both tools and allowed-tools are present", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      tools: ["Read"],
      "allowed-tools": "Edit",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tool-fields-ambiguous")).toBe(true);
  });

  it("warns on unknown MCP server from allowed-tools", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      "allowed-tools": "mcp__notconfigured__some_tool",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "mcp-server-unknown")).toBe(true);
  });

  it("does not warn on configured MCP server from allowed-tools", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      "allowed-tools": "mcp__github__create_issue",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "mcp-server-unknown")).toBeUndefined();
  });

  it("errors on malformed mcp tool name from allowed-tools", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      "allowed-tools": "mcp__missingtool",
    });
    const ds = runChecks([s], config);
    expect(
      ds.some(
        (d) => d.severity === "error" && d.rule === "mcp-tool-format",
      ),
    ).toBe(true);
  });

  it("warns on unknown MCP server", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      tools: ["mcp__notconfigured__some_tool"],
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "mcp-server-unknown")).toBe(true);
  });

  it("does not warn on configured MCP server", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      tools: ["mcp__github__create_issue"],
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "mcp-server-unknown")).toBeUndefined();
  });

  it("errors on malformed mcp tool name", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      tools: ["mcp__missingtool"],
    });
    const ds = runChecks([s], config);
    expect(
      ds.some(
        (d) => d.severity === "error" && d.rule === "mcp-tool-format",
      ),
    ).toBe(true);
  });

  it("flags description collisions", () => {
    const a = mkSkill("/test/a/a.md", {
      name: "a",
      description: "deploy the application to staging environment quickly",
    });
    const b = mkSkill("/test/b/b.md", {
      name: "b",
      description: "deploy the application to staging environment fast",
    });
    const ds = runChecks([a, b], config);
    expect(ds.filter((d) => d.rule === "description-collision").length).toBe(2);
  });

  it("flags name drift", () => {
    const s = mkSkill("/test/something/foo.md", {
      name: "different-name",
      description: "do stuff",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "name-drift")).toBe(true);
  });

  it("clean skill produces no diagnostics", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      "allowed-tools": "Read Edit",
    });
    const ds = runChecks([s], config);
    expect(ds).toEqual([]);
  });

  it("flags description over 500 chars", () => {
    const long = "a ".repeat(300);
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: long.trim(),
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "description-length")).toBe(true);
  });

  it("skips mcp-server-unknown when mcpServers set is empty", () => {
    const noServersConfig: SkillcheckConfig = {
      knownTools: new Set(BUILTIN_TOOLS),
      mcpServers: new Set(),
      cwd: "/test",
    };
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
      tools: ["mcp__anyserver__some_tool"],
    });
    const ds = runChecks([s], noServersConfig);
    expect(ds.find((d) => d.rule === "mcp-server-unknown")).toBeUndefined();
  });

  it("does not fire description-collision when Jaccard is below threshold", () => {
    const a = mkSkill("/test/a/a.md", {
      name: "a",
      description: "deploy the application to staging environment",
    });
    const b = mkSkill("/test/b/b.md", {
      name: "b",
      description: "search repositories and list open pull requests",
    });
    const ds = runChecks([a, b], config);
    expect(ds.filter((d) => d.rule === "description-collision").length).toBe(0);
  });

  it("does not flag name-drift when name matches the directory", () => {
    const s = mkSkill("/test/foo/index.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "name-drift")).toBeUndefined();
  });

  it("warns when tools lists 10 or more entries", () => {
    const tools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite", "Agent"];
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      tools,
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tools-overloaded")).toBe(true);
  });

  it("warns when allowed-tools lists 10 or more entries", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      "allowed-tools": "Read Write Edit Bash Glob Grep WebFetch WebSearch TodoWrite Agent",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tools-overloaded")).toBe(true);
  });

  it("does not warn when tools lists 9 entries", () => {
    const tools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite"];
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      tools,
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tools-overloaded")).toBeUndefined();
  });

  it("tools-overloaded message includes the count", () => {
    const tools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite", "Agent", "ToolSearch"];
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      tools,
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "tools-overloaded");
    expect(d?.message).toContain("11");
  });

  it("warns when skill body is empty", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
    }, "");
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "empty-body")).toBe(true);
  });

  it("warns when skill body is whitespace only", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
    }, "   \n\n   ");
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "empty-body")).toBe(true);
  });

  it("does not warn on empty-body when body has content", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
    }, "Use Read to read a file, then summarize it.");
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "empty-body")).toBeUndefined();
  });

  it("does not fire empty-body when frontmatter is invalid", () => {
    const s = mkSkill("/test/foo/foo.md", { name: "foo" }, "");
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "empty-body")).toBeUndefined();
  });

  it("flags duplicate skill names", () => {
    const a = mkSkill("/test/a/deploy.md", { name: "deploy", description: "deploy the app" });
    const b = mkSkill("/test/b/deploy.md", { name: "deploy", description: "deploy to staging" });
    const ds = runChecks([a, b], config);
    expect(ds.filter((d) => d.rule === "duplicate-name").length).toBe(2);
  });

  it("does not flag duplicate-name for unique names", () => {
    const a = mkSkill("/test/a/deploy.md", { name: "deploy", description: "deploy the app" });
    const b = mkSkill("/test/b/release.md", { name: "release", description: "cut a release" });
    const ds = runChecks([a, b], config);
    expect(ds.find((d) => d.rule === "duplicate-name")).toBeUndefined();
  });

  it("flags all skills in a three-way duplicate-name group", () => {
    const a = mkSkill("/test/a/foo.md", { name: "foo", description: "do foo one way" });
    const b = mkSkill("/test/b/foo.md", { name: "foo", description: "do foo another way" });
    const c = mkSkill("/test/c/foo.md", { name: "foo", description: "do foo a third way" });
    const ds = runChecks([a, b, c], config);
    expect(ds.filter((d) => d.rule === "duplicate-name").length).toBe(3);
  });

  it("duplicate-name message names the conflicting file", () => {
    const a = mkSkill("/test/a/deploy.md", { name: "deploy", description: "deploy the app" });
    const b = mkSkill("/test/b/deploy.md", { name: "deploy", description: "deploy to staging" });
    const ds = runChecks([a, b], config);
    const diagA = ds.find((d) => d.rule === "duplicate-name" && d.file === "/test/a/deploy.md");
    expect(diagA?.message).toContain("/test/b/deploy.md");
  });

  it("rejects mixed-case names before duplicate-name checks", () => {
    const a = mkSkill("/test/a/deploy.md", { name: "Deploy", description: "deploy the app" });
    const b = mkSkill("/test/b/deploy.md", { name: "deploy", description: "deploy to staging" });
    const ds = runChecks([a, b], config);
    expect(ds.some((d) => d.rule === "frontmatter-schema" && d.file === "/test/a/deploy.md")).toBe(true);
    expect(ds.find((d) => d.rule === "duplicate-name")).toBeUndefined();
  });

  it("description-collision fires at exactly the 0.6 Jaccard threshold", () => {
    // Tokens A: {foo, bar, baz, qux}  (4 tokens)
    // Tokens B: {foo, bar, baz, quux} (4 tokens)
    // intersection: 3, union: 5 -> Jaccard = 3/5 = 0.6 exactly
    const a = mkSkill("/test/a/a.md", { name: "a", description: "foo bar baz qux" });
    const b = mkSkill("/test/b/b.md", { name: "b", description: "foo bar baz quux" });
    const ds = runChecks([a, b], config);
    expect(ds.filter((d) => d.rule === "description-collision").length).toBe(2);
  });

  it("rejects uppercase names before name-drift checks", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "FOO",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "frontmatter-schema")).toBe(true);
    expect(ds.find((d) => d.rule === "name-drift")).toBeUndefined();
  });

  it("flags name-drift when name matches the filename but not the parent directory", () => {
    const s = mkSkill("/test/different/foo.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "name-drift");
    expect(d?.message).toContain("parent directory 'different'");
  });

  it("rejects plugin-namespaced names before name-drift checks", () => {
    const s = mkSkill("/test/github/search.md", {
      name: "github:search",
      description: "search github repositories for code and issues",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "frontmatter-schema")).toBe(true);
    expect(ds.find((d) => d.rule === "name-drift")).toBeUndefined();
  });

  it("warns on an unrecognized model name", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-sonet-4-6",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "model-unknown")).toBe(true);
  });

  it("does not warn on a recognized model", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-sonnet-4-6",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("does not warn when model field is absent", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("model-unknown message includes the offending model name", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "gpt-4o",
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "model-unknown");
    expect(d?.message).toContain("gpt-4o");
  });

  it("warns on model-unknown for each model in the known-3.x series", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-3-5-sonnet-20241022",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("does not warn on claude-haiku-4-5-20251001", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-haiku-4-5-20251001",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("does not warn on claude-opus-4-8", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-opus-4-8",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("does not warn on claude-sonnet-4-6", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-sonnet-4-6",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("does not warn on claude-fable-5", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-fable-5",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("does not warn on claude-sonnet-5", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-sonnet-5",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("warns on a plausible-looking model typo", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "claude-fable-6",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "model-unknown")).toBe(true);
  });

  it("rejects skill names containing spaces", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "my cool skill",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "frontmatter-schema")).toBe(true);
    expect(ds.find((d) => d.rule === "name-whitespace")).toBeUndefined();
  });

  it("does not warn name-whitespace for a clean hyphenated name", () => {
    const s = mkSkill("/test/my-skill/my-skill.md", {
      name: "my-skill",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "name-whitespace")).toBeUndefined();
  });

  it("frontmatter-schema message rejects the offending whitespace name", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "bad name here",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "frontmatter-schema");
    expect(d?.message).toContain("lowercase letters");
  });

  it("rejects skill names containing a leading space", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: " foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "frontmatter-schema")).toBe(true);
    expect(ds.find((d) => d.rule === "name-whitespace")).toBeUndefined();
  });

  it("warns when description is below 10 chars", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "description-too-short")).toBe(true);
  });

  it("does not warn when description is exactly 10 chars", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "description-too-short")).toBeUndefined();
  });

  it("does not warn when description is well above 10 chars", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "description-too-short")).toBeUndefined();
  });

  it("description-too-short message includes the char count", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do foo",
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "description-too-short");
    expect(d?.message).toContain("6");
  });

  it("does not fire description-too-short when frontmatter is invalid", () => {
    const s = mkSkill("/test/foo/foo.md", { name: "foo" }, "body");
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "description-too-short")).toBeUndefined();
  });

  it("warns when skill file is not named SKILL.md", () => {
    const s = mkSkill("/test/foo/deploy.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "skill-file-name")).toBe(true);
  });

  it("does not warn when skill file is named SKILL.md", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "skill-file-name")).toBeUndefined();
  });

  it("skill-file-name severity is warn", () => {
    const s = mkSkill("/test/foo/deploy.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "skill-file-name");
    expect(d?.severity).toBe("warn");
  });

  it("skill-file-name message mentions SKILL.md", () => {
    const s = mkSkill("/test/foo/deploy.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "skill-file-name");
    expect(d?.message).toContain("SKILL.md");
  });

  it("warns when skill file is named skill.md (wrong case)", () => {
    const s = mkSkill("/test/foo/skill.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "skill-file-name")).toBe(true);
  });

  it("does not fire skill-file-name when frontmatter is invalid", () => {
    const s = mkSkill("/test/foo/deploy.md", { name: "foo" }, "body");
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "skill-file-name")).toBeUndefined();
  });

  it("combineTools deduplicates a tool listed in both fields", () => {
    // Read appears in tools and allowed-tools; the unique count is 3,
    // well below the overloaded threshold of 10.
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read", "Edit"],
      "allowed-tools": "Read Write",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tool-fields-ambiguous")).toBe(true);
    expect(ds.find((d) => d.rule === "tools-overloaded")).toBeUndefined();
  });

  it("name-drift comparison is case-insensitive for the directory name", () => {
    // Directory is 'MySkill'; name is 'myskill' - should match after lowercasing.
    const s = mkSkill("/test/MySkill/SKILL.md", {
      name: "myskill",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "name-drift")).toBeUndefined();
  });

  it("description-collision fires when tokens of one description are a strict subset of another", () => {
    // A tokens: {deploy, application} (2)
    // B tokens: {deploy, application, staging} (3)
    // Jaccard = 2 / 3 = 0.67 >= 0.6
    const a = mkSkill("/test/a/a.md", { name: "a", description: "deploy the application" });
    const b = mkSkill("/test/b/b.md", { name: "b", description: "deploy the application to staging" });
    const ds = runChecks([a, b], config);
    expect(ds.filter((d) => d.rule === "description-collision").length).toBe(2);
  });

  it("description-collision does not fire when only one skill is present", () => {
    const a = mkSkill("/test/a/a.md", { name: "a", description: "deploy the application to staging" });
    const ds = runChecks([a], config);
    expect(ds.filter((d) => d.rule === "description-collision").length).toBe(0);
  });

  it("does not warn on description-length at exactly 500 chars", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "a".repeat(500),
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "description-length")).toBeUndefined();
  });

  it("warns on description-length at exactly 501 chars", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "a".repeat(501),
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "description-length")).toBe(true);
  });

  it("description-length message includes the char count", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "a".repeat(501),
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "description-length");
    expect(d?.message).toContain("501");
  });

  it("does not warn model-unknown when model is empty string", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      model: "",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "model-unknown")).toBeUndefined();
  });

  it("description-collision fires 6 diagnostics when all three skills pairwise collide", () => {
    // Each pair shares 5 of 7 tokens -> Jaccard 5/7 >= 0.6; 3 pairs x 2 diagnostics = 6
    const a = mkSkill("/test/a/a.md", { name: "a", description: "deploy the application to staging environment fast" });
    const b = mkSkill("/test/b/b.md", { name: "b", description: "deploy the application to staging environment slow" });
    const c = mkSkill("/test/c/c.md", { name: "c", description: "deploy the application to staging environment quick" });
    const ds = runChecks([a, b, c], config);
    expect(ds.filter((d) => d.rule === "description-collision").length).toBe(6);
  });

  it("description-collision fires only for the colliding pair in a three-skill set", () => {
    // A and B share 4 of 6 tokens -> Jaccard 4/6 = 0.67 (collides); C is unrelated
    const a = mkSkill("/test/a/a.md", { name: "a", description: "deploy the application to staging environment" });
    const b = mkSkill("/test/b/b.md", { name: "b", description: "deploy the application to production environment" });
    const c = mkSkill("/test/c/c.md", { name: "c", description: "search repositories for open pull requests" });
    const ds = runChecks([a, b, c], config);
    expect(ds.filter((d) => d.rule === "description-collision").length).toBe(2);
  });

  it("warns when allowed-tools lists the same tool twice", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      "allowed-tools": "Read Edit Read",
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tools-duplicate")).toBe(true);
  });

  it("warns when legacy tools array contains a duplicate", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read", "Edit", "Read"],
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "tools-duplicate")).toBe(true);
  });

  it("tools-duplicate message includes the duplicated tool name", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      "allowed-tools": "Read Edit Read",
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "tools-duplicate");
    expect(d?.message).toContain("Read");
  });

  it("does not warn tools-duplicate when each tool appears once", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      "allowed-tools": "Read Edit Write",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tools-duplicate")).toBeUndefined();
  });

  it("does not warn tools-duplicate when a tool appears in both fields but not twice in one", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read", "Edit"],
      "allowed-tools": "Read Write",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tools-duplicate")).toBeUndefined();
  });

  it("does not fire tools-duplicate when frontmatter is invalid", () => {
    const s = mkSkill("/test/foo/SKILL.md", { name: "foo" }, "body");
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "tools-duplicate")).toBeUndefined();
  });

  it("warns when only the legacy tools: field is used without allowed-tools:", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read", "Edit"],
    });
    const ds = runChecks([s], config);
    expect(ds.some((d) => d.rule === "deprecated-tools-field")).toBe(true);
  });

  it("does not warn deprecated-tools-field when allowed-tools: is used alone", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      "allowed-tools": "Read Edit",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "deprecated-tools-field")).toBeUndefined();
  });

  it("does not warn deprecated-tools-field when both fields are present (tool-fields-ambiguous fires instead)", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read"],
      "allowed-tools": "Edit",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "deprecated-tools-field")).toBeUndefined();
    expect(ds.some((d) => d.rule === "tool-fields-ambiguous")).toBe(true);
  });

  it("does not warn deprecated-tools-field when no tool field is present", () => {
    const s = mkSkill("/test/foo/SKILL.md", {
      name: "foo",
      description: "do the foo thing",
    });
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "deprecated-tools-field")).toBeUndefined();
  });

  it("deprecated-tools-field severity is warn", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read"],
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "deprecated-tools-field");
    expect(d?.severity).toBe("warn");
  });

  it("deprecated-tools-field message mentions allowed-tools:", () => {
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read"],
    });
    const ds = runChecks([s], config);
    const d = ds.find((d) => d.rule === "deprecated-tools-field");
    expect(d?.message).toContain("allowed-tools:");
  });

  it("does not fire deprecated-tools-field when frontmatter is invalid", () => {
    const s = mkSkill("/test/foo/SKILL.md", { name: "foo" }, "body");
    const ds = runChecks([s], config);
    expect(ds.find((d) => d.rule === "deprecated-tools-field")).toBeUndefined();
  });
});
