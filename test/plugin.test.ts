import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugins, runPlugins } from "../src/plugin.js";
import type {
  Diagnostic,
  ParsedSkill,
  SkillcheckConfig,
  ValidatedSkill,
} from "../src/types.js";

let tmp = "";

const baseConfig: SkillcheckConfig = {
  knownTools: new Set(["Read", "Edit", "Bash"]),
  mcpServers: new Set(),
  cwd: process.cwd(),
};

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "skillcheck-plugin-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writePluginModule(
  rel: string,
  source: string,
): Promise<string> {
  const path = join(tmp, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, source, "utf8");
  return path;
}

const baseValidated: ValidatedSkill = {
  file: "/tmp/x.md",
  raw: "",
  frontmatter: {},
  body: "",
  bodyStartLine: 1,
  name: "x",
  description: "y",
  tools: [],
};

describe("loadPlugins", () => {
  it("loads an object-export plugin from a filesystem path", async () => {
    const plugin = await writePluginModule(
      "p.mjs",
      `export default {
        name: "obj",
        rules: [
          { id: "always-warn", check: () => [{
            severity: "warn", rule: "obj/always-warn",
            message: "hi", file: "/x"
          }] },
        ],
      };`,
    );
    const [p] = await loadPlugins([plugin], tmp);
    expect(p?.name).toBe("obj");
    expect(p?.rules).toHaveLength(1);
  });

  it("loads a function-export plugin (sync)", async () => {
    const plugin = await writePluginModule(
      "fn.mjs",
      `export default () => ({ name: "fn", rules: [] });`,
    );
    const [p] = await loadPlugins([plugin], tmp);
    expect(p?.name).toBe("fn");
  });

  it("loads a function-export plugin (async)", async () => {
    const plugin = await writePluginModule(
      "afn.mjs",
      `export default async () => ({ name: "afn", rules: [] });`,
    );
    const [p] = await loadPlugins([plugin], tmp);
    expect(p?.name).toBe("afn");
  });

  it("rejects a module without a default export", async () => {
    const plugin = await writePluginModule(
      "no-default.mjs",
      `export const named = {};`,
    );
    await expect(loadPlugins([plugin], tmp)).rejects.toThrow(
      /no default export/,
    );
  });

  it("rejects a default export that is not { name, rules }", async () => {
    const plugin = await writePluginModule(
      "bad.mjs",
      `export default { name: "x" };`,
    );
    await expect(loadPlugins([plugin], tmp)).rejects.toThrow(
      /not \{ name, rules \}/,
    );
  });
});

describe("runPlugins", () => {
  it("collects diagnostics from every rule of every plugin", async () => {
    const ctx = {
      parsed: [] as ParsedSkill[],
      validated: [baseValidated],
      config: baseConfig,
    };
    const diags = await runPlugins(
      [
        {
          name: "p1",
          rules: [
            {
              id: "r1",
              check: (): Diagnostic[] => [
                {
                  severity: "warn",
                  rule: "p1/r1",
                  message: "from p1",
                  file: "/a",
                },
              ],
            },
          ],
        },
        {
          name: "p2",
          rules: [
            {
              id: "r2",
              check: (): Diagnostic[] => [
                {
                  severity: "error",
                  rule: "p2/r2",
                  message: "from p2",
                  file: "/b",
                },
              ],
            },
          ],
        },
      ],
      ctx,
    );
    expect(diags.map((d) => d.rule).sort()).toEqual(["p1/r1", "p2/r2"]);
  });

  it("converts a thrown rule into an error diagnostic and keeps going", async () => {
    const ctx = {
      parsed: [] as ParsedSkill[],
      validated: [baseValidated],
      config: baseConfig,
    };
    const diags = await runPlugins(
      [
        {
          name: "boom",
          rules: [
            {
              id: "r-throw",
              check: () => {
                throw new Error("kaboom");
              },
            },
            {
              id: "r-ok",
              check: (): Diagnostic[] => [
                {
                  severity: "info",
                  rule: "boom/r-ok",
                  message: "still here",
                  file: "/x",
                },
              ],
            },
          ],
        },
      ],
      ctx,
    );
    const thrown = diags.find((d) => d.rule === "boom/r-throw");
    expect(thrown?.severity).toBe("error");
    expect(thrown?.message).toContain("kaboom");
    const okDiag = diags.find((d) => d.rule === "boom/r-ok");
    expect(okDiag?.message).toBe("still here");
  });

  it("stamps a missing rule field with plugin/id when omitted", async () => {
    const ctx = {
      parsed: [] as ParsedSkill[],
      validated: [baseValidated],
      config: baseConfig,
    };
    const diags = await runPlugins(
      [
        {
          name: "auto",
          rules: [
            {
              id: "missing-rule-id",
              check: (): Diagnostic[] => [
                {
                  severity: "warn",
                  // no `rule` field; runPlugins must fill it in
                  rule: "",
                  message: "no rule field set",
                  file: "/x",
                },
              ],
            },
          ],
        },
      ],
      ctx,
    );
    expect(diags[0]?.rule).toBe("auto/missing-rule-id");
  });
});
