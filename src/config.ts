import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUILTIN_TOOLS } from "./builtins.js";
import type { SkillcheckConfig } from "./types.js";

interface SettingsJson {
  mcpServers?: Record<string, unknown>;
}

async function readSettingsJson(path: string): Promise<SettingsJson | null> {
  try {
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SettingsJson;
  } catch {
    return null;
  }
}

export async function loadConfig(cwd: string): Promise<SkillcheckConfig> {
  const candidates = [
    join(homedir(), ".claude", "settings.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];

  const mcpServers = new Set<string>();
  for (const path of candidates) {
    const settings = await readSettingsJson(path);
    if (settings?.mcpServers) {
      for (const name of Object.keys(settings.mcpServers)) {
        mcpServers.add(name);
      }
    }
  }

  return {
    knownTools: new Set(BUILTIN_TOOLS),
    mcpServers,
    cwd,
  };
}
