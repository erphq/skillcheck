# Contributing to skillcheck

Thanks for considering a contribution. The codebase is small and the
test suite is fast - a typical PR cycle is under five minutes.

## Quickstart

```sh
git clone https://github.com/erphq/skillcheck
cd skillcheck
npm install
npm run lint
npm run build
npm test
```

All four commands must pass before opening a PR. CI runs the same set.

## Project shape

- `src/rules/` - one file per check rule. Each exports a `Rule` object
  with a stable `id`, `name`, `severity`, and a `check(skill)` function
  returning zero or more `Finding`s.
- `src/format/` - reporters. JSON, Markdown, SARIF.
- `test/` - vitest test files mirroring `src/`.

## Adding a new rule

1. Create `src/rules/<rule-id>.ts`. Pick a stable kebab-case id
   (`missing-description`, `unsafe-tool-name`, etc).
2. Export the `Rule` per the existing pattern.
3. Add to the rule registry in `src/rules/index.ts`.
4. Add a `*.test.ts` covering one positive and one negative case at
   minimum.
5. Add an entry to `CHANGELOG.md` under `[Unreleased]`.

Rules should be pure functions over the parsed skill. No I/O, no
network calls, no environment access.

## Testing without secrets

skillcheck is static analysis: there are no API keys, no model calls,
no external services to mock. If you find yourself reaching for a
network call, the change probably belongs in a separate runtime tool.

## Conventions

- TypeScript strict mode is on. Don't disable it.
- No em dashes in code, comments, or docs (writing-style rule).
- Commit messages: `feat(rules): <what>` / `fix(...)` / `docs(...)`.
- Keep PRs focused. One rule, one fix, or one refactor per PR.
- Open issues before large changes; tiny changes can land as a direct PR.

## Releasing

Maintainers tag releases on the GitHub UI. The `release.yml` workflow
publishes to npm with provenance. Contributors do not need npm
credentials.
