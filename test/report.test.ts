import { describe, expect, it } from "vitest";

import { reportJson, reportText } from "../src/report.js";
import type { Diagnostic } from "../src/types.js";

// `reportText` and `reportJson` are the operator-facing output;
// shell scripts pipe `reportJson` to `jq`, and humans read
// `reportText`. Both are pure formatters over a Diagnostic[].

function diag(over: Partial<Diagnostic>): Diagnostic {
  return {
    file: "/repo/skill.md",
    rule: "test-rule",
    severity: "error",
    message: "something happened",
    ...over,
  } as Diagnostic;
}

describe("reportText — empty input", () => {
  it("renders 'no issues' when there are no diagnostics", () => {
    // The CI gate `skillcheck && echo ok` relies on this being
    // a stable success message; a regression to "0 issues" or
    // similar would silently break operator tooling.
    const out = reportText([], "/repo");
    expect(out).toContain("no issues");
  });
});

describe("reportText — grouping and counts", () => {
  it("groups diagnostics under a per-file header", () => {
    const out = reportText(
      [
        diag({ file: "/repo/a.md", message: "first" }),
        diag({ file: "/repo/a.md", message: "second" }),
        diag({ file: "/repo/b.md", message: "third" }),
      ],
      "/repo",
    );
    // Both diagnostics for a.md should appear under one header.
    const aIdx = out.indexOf("a.md");
    const bIdx = out.indexOf("b.md");
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(bIdx);
    expect(out).toContain("first");
    expect(out).toContain("second");
    expect(out).toContain("third");
  });

  it("renders paths relative to cwd", () => {
    // Operators read these paths in their terminal; absolute
    // paths are noisy. The relative form is the documented
    // convention.
    const out = reportText([diag({ file: "/repo/skills/foo.md" })], "/repo");
    expect(out).toContain("skills/foo.md");
    expect(out).not.toContain("/repo/skills/foo.md");
  });

  it("includes rule name and message in each diagnostic line", () => {
    const out = reportText(
      [diag({ rule: "no-bare-tools", message: "tools list is empty" })],
      "/repo",
    );
    expect(out).toContain("no-bare-tools");
    expect(out).toContain("tools list is empty");
  });

  it("includes a severity-aware summary footer", () => {
    const out = reportText(
      [
        diag({ severity: "error" }),
        diag({ severity: "error" }),
        diag({ severity: "warn" }),
        diag({ severity: "info" }),
      ],
      "/repo",
    );
    // 2 errors / 1 warn / 1 info — pin the exact wording so a
    // refactor doesn't drift the operator-facing summary.
    expect(out).toContain("2 errors");
    expect(out).toContain("1 warning");
    expect(out).toContain("1 info");
  });

  it("uses singular forms when count is 1", () => {
    const out = reportText([diag({ severity: "error" })], "/repo");
    expect(out).toContain("1 error,");
    expect(out).not.toContain("1 errors");
  });
});

describe("reportJson — wire format", () => {
  it("returns an object with a 'diagnostics' key", () => {
    // Shell scripts pipe this to `jq '.diagnostics[]'`; the key
    // name is the public contract.
    const out = reportJson([diag({})]);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("diagnostics");
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
  });

  it("preserves every diagnostic field through the round-trip", () => {
    const d = diag({
      file: "/x.md",
      rule: "r1",
      severity: "warn",
      message: "m",
    });
    const parsed = JSON.parse(reportJson([d]));
    expect(parsed.diagnostics[0]).toEqual(d);
  });

  it("returns a JSON object even on empty input", () => {
    // Empty diagnostics still produces `{"diagnostics": []}`,
    // not `null` or an empty string — pin so JSON-mode pipelines
    // never crash on a clean run.
    const parsed = JSON.parse(reportJson([]));
    expect(parsed.diagnostics).toEqual([]);
  });

  it("emits indented JSON for human readability", () => {
    // The 2-space indent makes JSON-mode output diff-friendly when
    // operators check it into a results file.
    const out = reportJson([diag({})]);
    expect(out).toContain("\n  ");
  });
});
