import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { BUILTIN_TOOLS } from "../src/builtins.js";

// `loadConfig` resolves the linter's "what tools are valid" set by
// reading three settings.json candidates in order:
//   ~/.claude/settings.json
//   <cwd>/.claude/settings.json
//   <cwd>/.claude/settings.local.json
//
// All three contribute to a union of MCP server names. Built-in
// tools are added unconditionally. The tests pin behaviour against
// fixtures in tmpdir so the linter's view of "is this a real tool"
// doesn't drift silently.

describe("loadConfig", () => {
  let workDir: string;
  let homeDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "skillcheck-cwd-"));
    homeDir = mkdtempSync(join(tmpdir(), "skillcheck-home-"));
    // Stub `homedir` so `~/.claude/settings.json` lookups land in
    // the test's tmpdir, not the real user's home.
    vi.stubEnv("HOME", homeDir);
    // Some platforms use USERPROFILE; cover both.
    vi.stubEnv("USERPROFILE", homeDir);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function writeSettings(dir: string, name: string, body: unknown): void {
    const claudeDir = join(dir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, name), JSON.stringify(body), "utf8");
  }

  it("returns BUILTIN_TOOLS even when no settings files exist", () => {
    return loadConfig(workDir).then((cfg) => {
      expect(cfg.knownTools).toEqual(new Set(BUILTIN_TOOLS));
      expect(cfg.mcpServers.size).toBe(0);
      expect(cfg.cwd).toBe(workDir);
    });
  });

  it("collects mcpServers from cwd/.claude/settings.json", async () => {
    writeSettings(workDir, "settings.json", {
      mcpServers: { "my-server": {}, "another": {} },
    });
    const cfg = await loadConfig(workDir);
    expect(cfg.mcpServers.has("my-server")).toBe(true);
    expect(cfg.mcpServers.has("another")).toBe(true);
  });

  it("collects mcpServers from cwd/.claude/settings.local.json", async () => {
    // `settings.local.json` is the operator's per-machine override
    // and contributes to the same union.
    writeSettings(workDir, "settings.local.json", {
      mcpServers: { "local-only": {} },
    });
    const cfg = await loadConfig(workDir);
    expect(cfg.mcpServers.has("local-only")).toBe(true);
  });

  it("collects mcpServers from ~/.claude/settings.json", async () => {
    writeSettings(homeDir, "settings.json", {
      mcpServers: { "user-global": {} },
    });
    const cfg = await loadConfig(workDir);
    expect(cfg.mcpServers.has("user-global")).toBe(true);
  });

  it("unions mcpServers across all three files", async () => {
    // Documented behaviour: the result is a union, not a
    // last-writer-wins; a name appearing in any of the three
    // sources means it counts as known.
    writeSettings(homeDir, "settings.json", {
      mcpServers: { "from-home": {} },
    });
    writeSettings(workDir, "settings.json", {
      mcpServers: { "from-cwd": {} },
    });
    writeSettings(workDir, "settings.local.json", {
      mcpServers: { "from-local": {} },
    });
    const cfg = await loadConfig(workDir);
    expect(cfg.mcpServers).toEqual(
      new Set(["from-home", "from-cwd", "from-local"]),
    );
  });

  it("ignores a settings.json without an mcpServers field", async () => {
    writeSettings(workDir, "settings.json", { otherStuff: { x: 1 } });
    const cfg = await loadConfig(workDir);
    expect(cfg.mcpServers.size).toBe(0);
  });

  it("does not crash on a malformed settings.json", async () => {
    // A garbled settings.json is a real-world scenario (operator
    // mid-edit, syntax error). The loader documents that it
    // silently skips invalid files; pin so a regression to
    // "throw on bad JSON" doesn't break every skill check on a
    // partial save.
    const claudeDir = join(workDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "settings.json"), "{not json", "utf8");
    const cfg = await loadConfig(workDir);
    expect(cfg.mcpServers.size).toBe(0); // skipped silently
    // Built-ins are still loaded.
    expect(cfg.knownTools.size).toBeGreaterThan(0);
  });

  it("preserves the cwd it was called with", async () => {
    const cfg = await loadConfig(workDir);
    expect(cfg.cwd).toBe(workDir);
  });
});
