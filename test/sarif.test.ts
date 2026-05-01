import { describe, it, expect } from "vitest";
import { reportSarif } from "../src/sarif.js";
import type { Diagnostic } from "../src/types.js";

const opts = { toolVersion: "0.1.0" };

describe("reportSarif", () => {
  it("emits a SARIF 2.1.0 envelope", () => {
    const out = JSON.parse(reportSarif([], "/test", opts));
    expect(out.version).toBe("2.1.0");
    expect(out.$schema).toContain("sarif-2.1.0");
    expect(Array.isArray(out.runs)).toBe(true);
    expect(out.runs[0].tool.driver.name).toBe("skillcheck");
    expect(out.runs[0].tool.driver.version).toBe("0.1.0");
  });

  it("declares the full rule catalog when there are no diagnostics", () => {
    const out = JSON.parse(reportSarif([], "/test", opts));
    const ruleIds = out.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ruleIds).toContain("frontmatter-schema");
    expect(ruleIds).toContain("tool-unknown");
    expect(ruleIds).toContain("description-collision");
    expect(out.runs[0].results).toEqual([]);
  });

  it("converts severities to SARIF levels", () => {
    const diagnostics: Diagnostic[] = [
      { severity: "error", rule: "frontmatter-schema", message: "boom", file: "/test/a.md" },
      { severity: "warn", rule: "tool-unknown", message: "huh", file: "/test/b.md" },
      { severity: "info", rule: "tool-unknown", message: "fyi", file: "/test/c.md" },
    ];
    const out = JSON.parse(reportSarif(diagnostics, "/test", opts));
    const levels = out.runs[0].results.map((r: { level: string }) => r.level);
    expect(levels).toEqual(["error", "warning", "note"]);
  });

  it("uses repo-relative URIs for files", () => {
    const diagnostics: Diagnostic[] = [
      {
        severity: "warn",
        rule: "name-drift",
        message: "name drift",
        file: "/test/skills/foo/foo.md",
      },
    ];
    const out = JSON.parse(reportSarif(diagnostics, "/test", opts));
    const loc = out.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
    expect(loc.uri).toBe("skills/foo/foo.md");
    expect(loc.uriBaseId).toBe("%SRCROOT%");
  });

  it("attaches a region when line is provided", () => {
    const diagnostics: Diagnostic[] = [
      {
        severity: "error",
        rule: "parse",
        message: "bad yaml",
        file: "/test/x.md",
        line: 3,
      },
    ];
    const out = JSON.parse(reportSarif(diagnostics, "/test", opts));
    const region = out.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region).toEqual({ startLine: 3 });
  });

  it("ruleIndex points to the matching rule entry", () => {
    const diagnostics: Diagnostic[] = [
      { severity: "warn", rule: "tool-unknown", message: "x", file: "/test/a.md" },
    ];
    const out = JSON.parse(reportSarif(diagnostics, "/test", opts));
    const idx = out.runs[0].results[0].ruleIndex;
    const rule = out.runs[0].tool.driver.rules[idx];
    expect(rule.id).toBe("tool-unknown");
  });

  it("includes a synthetic rule entry for unknown rule ids", () => {
    const diagnostics: Diagnostic[] = [
      {
        severity: "warn",
        rule: "future-rule-not-yet-registered",
        message: "x",
        file: "/test/a.md",
      },
    ];
    const out = JSON.parse(reportSarif(diagnostics, "/test", opts));
    const ids = out.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ids).toContain("future-rule-not-yet-registered");
  });

  it("output is valid JSON", () => {
    const diagnostics: Diagnostic[] = [
      { severity: "error", rule: "parse", message: "x", file: "/test/a.md" },
    ];
    expect(() => JSON.parse(reportSarif(diagnostics, "/test", opts))).not.toThrow();
  });
});
