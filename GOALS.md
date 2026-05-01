# Goals

## North star
Be the linter every Claude Code skill author runs in CI. Within 6 months,
default tool in `erphq/skills` and adopted by ≥3 external skill repos.

## v0 success criteria
- Lints every skill in `erphq/skills` without false positives
- Catches the real bugs that exist there today
- Runs in <1s on 50 skills
- Single binary install via `npx skillcheck`

## v1 success criteria
- SARIF integration in GitHub Actions ✅ (v0.4 ships SARIF 2.1.0)
- Used by ≥3 external skill repos
- Schema versioned independently of Claude Code releases

## Architecture decisions
- TypeScript, single-package npm. No monorepo until needed.
- `zod` for schema, `yaml` for frontmatter, `fast-glob` for discovery
- Reporter is pluggable: text, json, sarif

## Non-goals
- Runtime evaluation of skills (no LLM calls)
- Auto-generating skills from descriptions
- Auth / sandboxing — that's the runtime's job

## Out of scope (for now)
- Plugin authoring (commands, hooks) — separate tool
- VS Code extension — defer until v1
