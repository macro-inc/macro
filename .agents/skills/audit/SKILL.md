---
name: audit
description: Post-change checks before handing off. Works out which checks apply from the files changed (directory AGENTS.md Checks sections and matching .agents/rules), runs or verifies each, and reports pass/fail/skipped. Use before saying work is done, before pushing, or when asked to audit or verify a change.
---

# Audit

Delegate to the `auditor` subagent when it is available, passing the base branch
(default `origin/main`), so command output stays out of your context. Otherwise
follow these steps yourself.

## 1. Changed files

```sh
base=$(git merge-base HEAD origin/main)
{ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u
```

## 2. Collect the checks

For every changed file:

- **Directory guides.** Each `AGENTS.md` from the file's directory up to the repo
  root: take its `## Checks` section, and the root guide's "Before handing off".
- **Rules.** Each file in `.agents/rules/` whose `paths:` globs match the file, plus
  rules with no `paths:`. Every bullet is a requirement to verify against the diff;
  a `Check:` line is a step to run.
- **Area defaults**, when no guide gives a more specific command:

| Changed | Check |
| --- | --- |
| Any | `just check` |
| Rust in a package | `cargo test -p <package>` (SQLX_OFFLINE unset), `cargo fmt --all -- --check`, `just clippy` |
| `sqlx::query!` or migrations | `.sqlx/` regenerated and committed; migration works with the code already deployed |
| `Cargo.toml` | `cargo x deps --check` |
| `apps/web` | `bun run check` and `bun run test` for the touched features, in `apps/web` |
| User-visible web behavior | Exercised in a browser; `docs/agent-guide` updated if routes, editors, AI surfaces, or composer changed |
| `infra/` | `bun run --cwd infra check`; no deploy was run |
| New or changed flow, cross-service call, queue, or background job | Instrumented per the observability rule; trace verified connected in Tempo, or listed as not verified |
| Any behavior, API, name, or workflow change | Every doc that mentions it is updated: touched directories' `AGENTS.md`, `docs/guides/`, `docs/architecture/`, agent guide, READMEs, rules, skills (grep the changed names) |
| Config, env vars, service URLs | Every copy and Doppler step in the config rule is done or listed as a follow-up |

Deduplicate. Run one command per package, not per file.

## 3. Run and verify

Run each command. For rule bullets that no command covers, read the relevant diff
hunks and judge. Don't stop at the first failure; finish the list.

## 4. Report

One table, failures first:

| Result | Check | Source | Evidence |
| --- | --- | --- | --- |
| fail | `cargo test -p calendar_service` | area default | 2 failed: `sync::tests::…` |
| pass | Decorator reserves its height | `web/lexical-nodes.md` | `Foo.tsx:40` sets `aspect-ratio` |
| skipped | Browser check | root guide | No browser in this environment |

A check is `pass` only if it ran or was verified in this audit. Explain every
`skipped`. Then list fixes for each failure; do not claim the work is done while
anything fails.
