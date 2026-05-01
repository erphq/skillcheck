import pc from "picocolors";
import { relative } from "node:path";
import type { Diagnostic } from "./types.js";

export function reportText(diagnostics: Diagnostic[], cwd: string): string {
  if (diagnostics.length === 0) {
    return pc.green("✓ no issues");
  }
  const lines: string[] = [];
  const grouped = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const arr = grouped.get(d.file) ?? [];
    arr.push(d);
    grouped.set(d.file, arr);
  }
  for (const [file, ds] of grouped) {
    lines.push(pc.bold(relative(cwd, file) || file));
    for (const d of ds) {
      const sev =
        d.severity === "error"
          ? pc.red("error")
          : d.severity === "warn"
            ? pc.yellow("warn ")
            : pc.cyan("info ");
      lines.push(`  ${sev} ${pc.dim(d.rule)} - ${d.message}`);
    }
    lines.push("");
  }
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warns = diagnostics.filter((d) => d.severity === "warn").length;
  const infos = diagnostics.filter((d) => d.severity === "info").length;
  lines.push(
    pc.dim(
      `${errors} error${errors === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}, ${infos} info`,
    ),
  );
  return lines.join("\n");
}

export function reportJson(diagnostics: Diagnostic[]): string {
  return JSON.stringify({ diagnostics }, null, 2);
}
