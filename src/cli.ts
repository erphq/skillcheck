#!/usr/bin/env node
import { Command } from "commander";
import fg from "fast-glob";
import { parseSkillFile, ParseError } from "./parse.js";
import { runChecks } from "./checks.js";
import { loadConfig } from "./config.js";
import { reportText, reportJson } from "./report.js";
import type { Diagnostic, ParsedSkill } from "./types.js";

interface CliOpts {
  strict?: boolean;
  format: string;
}

const program = new Command();

program
  .name("skillcheck")
  .description("Static analyzer for Claude Code skills")
  .version("0.1.0")
  .argument("[paths...]", "files or globs to lint", [".claude/skills/**/*.md"])
  .option("--strict", "treat warnings as errors")
  .option("--format <fmt>", "output format: text | json", "text")
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

    const out =
      opts.format === "json"
        ? reportJson(diagnostics)
        : reportText(diagnostics, cwd);
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
