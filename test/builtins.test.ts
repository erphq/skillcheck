import { describe, it, expect } from "vitest";
import {
  BUILTIN_TOOLS,
  isMcpTool,
  parseMcpToolName,
} from "../src/builtins.js";

describe("builtins", () => {
  it("BUILTIN_TOOLS includes core tools", () => {
    for (const t of ["Read", "Write", "Edit", "Bash", "Grep"]) {
      expect(BUILTIN_TOOLS.has(t)).toBe(true);
    }
  });

  it("isMcpTool detects mcp__ prefix", () => {
    expect(isMcpTool("mcp__github__create_issue")).toBe(true);
    expect(isMcpTool("Read")).toBe(false);
  });

  it("parseMcpToolName splits on __", () => {
    expect(parseMcpToolName("mcp__github__create_issue")).toEqual({
      server: "github",
      tool: "create_issue",
    });
  });

  it("parseMcpToolName tolerates underscores in tool name", () => {
    expect(parseMcpToolName("mcp__claude_ai_Gmail__authenticate")).toEqual({
      server: "claude_ai_Gmail",
      tool: "authenticate",
    });
  });

  it("parseMcpToolName rejects malformed names", () => {
    expect(parseMcpToolName("mcp__nodelimiter")).toBeNull();
    expect(parseMcpToolName("Read")).toBeNull();
    expect(parseMcpToolName("mcp__server__")).toBeNull();
  });
});
