# Changelog

All notable changes to `skillcheck` will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.0.0] — 2026-04-30

### Added
- Initial release.
- Zod-based frontmatter schema validation (`name`, `description`, `tools`).
- Known built-in tool list and `mcp__server__tool` parser.
- Checks: `frontmatter-schema`, `mcp-tool-format`, `tool-unknown`, `mcp-server-unknown`, `description-length`, `name-drift`, `description-collision`.
- CLI with text and JSON reporters, `--strict` mode, exit codes 0/1/2.
- 19 tests via vitest.
- GitHub Actions CI on push and pull_request.
