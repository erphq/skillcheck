import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import type {
  Diagnostic,
  ParsedSkill,
  SkillcheckConfig,
  ValidatedSkill,
} from "./types.js";

/**
 * Context passed into every plugin rule.
 *
 * `parsed` is the raw skill list (frontmatter + body) - including
 * skills whose schema validation failed - so a plugin can inspect a
 * malformed skill if it wants to. `validated` is the subset whose
 * frontmatter passed schema validation; most plugins will only use
 * this. `config` exposes the same `knownTools` / `mcpServers` /
 * `cwd` that the built-in checks see.
 */
export interface PluginContext {
  parsed: readonly ParsedSkill[];
  validated: readonly ValidatedSkill[];
  config: SkillcheckConfig;
}

/**
 * A rule runs once per `runPlugins` invocation and may emit zero or
 * more diagnostics. Rules that throw are caught: a plugin that crashes
 * does not take down the whole skillcheck run.
 */
export interface PluginRule {
  id: string;
  severity?: "error" | "warn" | "info";
  check: (ctx: PluginContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

export interface SkillcheckPlugin {
  name: string;
  rules: PluginRule[];
}

/**
 * The shape a plugin module must export. Either:
 *   export default { name, rules } as SkillcheckPlugin
 *   export default (): SkillcheckPlugin => ({ name, rules })
 *
 * The function form lets the plugin do per-run setup (e.g. read a
 * config file under `cwd`) before returning.
 */
export type PluginModule =
  | SkillcheckPlugin
  | (() => SkillcheckPlugin)
  | (() => Promise<SkillcheckPlugin>);

/**
 * Resolve and load plugin modules from filesystem paths or bare
 * module specifiers. Paths are resolved relative to `cwd`; bare
 * specifiers are passed through to the runtime resolver, which makes
 * `npm install --save-dev <plugin>` plus `--plugin <pkg>` work.
 *
 * Loading happens sequentially so plugin load order is predictable.
 */
export async function loadPlugins(
  specs: string[],
  cwd: string,
): Promise<SkillcheckPlugin[]> {
  const out: SkillcheckPlugin[] = [];
  for (const spec of specs) {
    const url = specToUrl(spec, cwd);
    let mod: { default?: PluginModule };
    try {
      mod = (await import(url)) as { default?: PluginModule };
    } catch (e) {
      throw new Error(
        `failed to import plugin '${spec}': ${(e as Error).message}`,
      );
    }
    const exported = mod.default;
    if (exported === undefined) {
      throw new Error(`plugin '${spec}' has no default export`);
    }
    const resolved =
      typeof exported === "function"
        ? await Promise.resolve(exported())
        : exported;
    if (
      !resolved ||
      typeof resolved.name !== "string" ||
      !Array.isArray(resolved.rules)
    ) {
      throw new Error(
        `plugin '${spec}' default export is not { name, rules }`,
      );
    }
    out.push(resolved);
  }
  return out;
}

/**
 * Run every loaded plugin against the same context the built-in
 * checks saw. A plugin rule that throws is converted to a diagnostic
 * tagged with the plugin name so the user can find it; we never let
 * a plugin take the whole run down.
 */
export async function runPlugins(
  plugins: SkillcheckPlugin[],
  ctx: PluginContext,
): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  for (const plugin of plugins) {
    for (const rule of plugin.rules) {
      try {
        const diags = await Promise.resolve(rule.check(ctx));
        // Stamp diagnostics with the plugin's rule id if the rule
        // didn't set one explicitly. Plugins should set their own
        // rule ids; this is a guardrail.
        for (const d of diags) {
          if (!d.rule) d.rule = `${plugin.name}/${rule.id}`;
          out.push(d);
        }
      } catch (e) {
        out.push({
          severity: "error",
          rule: `${plugin.name}/${rule.id}`,
          message: `plugin rule threw: ${(e as Error).message}`,
          file: "<plugin>",
        });
      }
    }
  }
  return out;
}

function specToUrl(spec: string, cwd: string): string {
  // A spec that starts with '.', '/', or has a drive letter is a
  // filesystem path. Everything else is treated as a module
  // specifier that node's resolver will look up in node_modules.
  const looksLikePath =
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(spec);
  if (looksLikePath) {
    return pathToFileURL(resolvePath(cwd, spec)).href;
  }
  return spec;
}
