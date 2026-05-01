# Changelog

All notable changes to `skillcheck` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] — 2026-05-01

### Added
- `release.yml` GitHub Actions workflow that publishes to npm on a
  GitHub Release. Reads `NPM_TOKEN` from repo secrets.
- This `CHANGELOG.md`.

## [0.4.0] — 2026-04-30

### Added
- SARIF 2.1.0 reporter (`--format sarif`). Static rule catalog with
  stable ids, names, severities, and `helpUri`s. Output is consumable
  by GitHub Code Scanning's `upload-sarif` action.
- New `RULES` export listing every rule the analyzer can emit.

## [0.3.0] — 2026-04-30

### Added
- Description-collision detector: flags pairs of skills whose
  descriptions overlap on token-set Jaccard ≥ 0.6.

## [0.2.0] — 2026-04-30

### Added
- MCP server reference check: warns when a skill's `tools:` array
  references an MCP server not configured in any reachable
  `settings.json` (`~/.claude/`, project root, project local).

## [0.1.0] — 2026-04-30

### Added
- TypeScript package with frontmatter-schema validation via `zod`.
- Built-in tool reference check (warns on unknown tool names).
- MCP-tool format check (errors on malformed `mcp__server__tool`).
- Description-length warning (>500 chars).
- Name-drift warning (frontmatter `name` ≠ filename or directory).
- `text` and `json` reporters.
- CLI: `--strict`, `--format`, exit codes 0/1/2.
- 19 vitest tests, GitHub Actions CI.

[Unreleased]: https://github.com/erphq/skillcheck/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/erphq/skillcheck/releases/tag/v0.5.0
[0.4.0]: https://github.com/erphq/skillcheck/releases/tag/v0.4.0
[0.3.0]: https://github.com/erphq/skillcheck/releases/tag/v0.3.0
[0.2.0]: https://github.com/erphq/skillcheck/releases/tag/v0.2.0
[0.1.0]: https://github.com/erphq/skillcheck/releases/tag/v0.1.0
