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
    const s = mkSkill("/test/foo/foo.md", {
      name: "foo",
      description: "do the foo thing",
      tools: ["Read", "Edit"],
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
});
