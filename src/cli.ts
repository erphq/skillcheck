#!/usr/bin/env node
import { Command } from "commander";
import fg from "fast-glob";
import { parseSkillFile, ParseError } from "./parse.js";
import { runChecks } from "./checks.js";
import { loadConfig } from "./config.js";
import { reportText, reportJson } from "./report.js";
import { reportSarif } from "./sarif.js";
import { applyFixes } from "./fix.js";
import { loadPlugins, runPlugins } from "./plugin.js";
import { SkillFrontmatter } from "./schema.js";
import type {
  Diagnostic,
  ParsedSkill,
  ValidatedSkill,
} from "./types.js";

const VERSION = "0.6.0";

interface CliOpts {
  strict?: boolean;
  format: string;
  fix?: boolean;
  fixDryRun?: boolean;
  plugin: string[];
}

const program = new Command();

program
  .name("skillcheck")
  .description("Static analyzer for Claude Code skills")
  .version(VERSION)
  .argument("[paths...]", "files or globs to lint", [".claude/skills/**/*.md"])
  .option("--strict", "treat warnings as errors")
  .option("--format <fmt>", "output format: text | json | sarif", "text")
  .option(
    "--fix",
    "apply safe auto-corrections in place (today: name-drift)",
  )
  .option(
    "--fix-dry-run",
    "report which files --fix would modify, but do not write",
  )
  .option(
    "--plugin <path...>",
    "load a plugin module (filesystem path or bare specifier); repeatable",
    collectPlugin,
    [],
  )
  .action(async (paths: string[], opts: CliOpts) => {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);

    const files = await fg(paths, {
      cwd,
      absolute: true,
      onlyFiles: true,
      dot: false,
    });

    if (files.length === 0) {
      console.error(
        `skillcheck: no files matched ${paths.join(" ")} (cwd: ${cwd})`,
      );
      process.exit(1);
    }

    const diagnostics: Diagnostic[] = [];
    const parsed: ParsedSkill[] = [];
    for (const f of files) {
      try {
        parsed.push(await parseSkillFile(f));
      } catch (e) {
        if (e instanceof ParseError) {
          diagnostics.push({
            severity: "error",
            rule: "parse",
            message: e.message,
            file: e.file,
          });
        } else {
          throw e;
        }
      }
    }
    diagnostics.push(...runChecks(parsed, config));

    // Plugin checks see the same parsed + validated set the built-ins
    // do, plus the resolved config. A plugin that throws can't take
    // down the whole run; runPlugins converts a thrown error into a
    // rule-tagged diagnostic.
    if (opts.plugin.length > 0) {
      const plugins = await loadPlugins(opts.plugin, cwd);
      const validated = buildValidated(parsed);
      diagnostics.push(
        ...(await runPlugins(plugins, {
          parsed,
          validated,
          config,
        })),
      );
    }

    if (opts.fix || opts.fixDryRun) {
      const outcome = await applyFixes(parsed, diagnostics, {
        dryRun: !!opts.fixDryRun,
      });
      const verb = opts.fixDryRun ? "would fix" : "fixed";
      console.error(
        `skillcheck: ${verb} ${outcome.fixed}, skipped ${outcome.skipped} (${outcome.filesChanged.length} file(s) ${opts.fixDryRun ? "would change" : "changed"})`,
      );
      for (const note of outcome.notes) console.error(`  ${note}`);
    }

    let out: string;
    switch (opts.format) {
      case "json":
        out = reportJson(diagnostics);
        break;
      case "sarif":
        out = reportSarif(diagnostics, cwd, { toolVersion: VERSION });
        break;
      case "text":
        out = reportText(diagnostics, cwd);
        break;
      default:
        console.error(`skillcheck: unknown format '${opts.format}'`);
        process.exit(1);
    }
    console.log(out);

    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warns = diagnostics.filter((d) => d.severity === "warn").length;
    if (errors > 0) process.exit(1);
    if (opts.strict && warns > 0) process.exit(2);
    process.exit(0);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

function collectPlugin(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function buildValidated(parsed: ParsedSkill[]): ValidatedSkill[] {
  const out: ValidatedSkill[] = [];
  for (const p of parsed) {
    const r = SkillFrontmatter.safeParse(p.frontmatter);
    if (!r.success) continue;
    out.push({
      ...p,
      name: r.data.name,
      description: r.data.description,
      tools: r.data.tools ?? [],
    });
  }
  return out;
}
