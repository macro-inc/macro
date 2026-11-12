# Rox enterprise recovery plan

## Graph and isolation

All resume branches start from the integration revision that includes this plan. Parallel source edits use real separate worktrees; path ownership alone is not isolation. Existing `main` edits (`.gitignore`, `CLAUDE.md`, `poltergeist.config.json`) are unrelated and must remain untouched.

| Node | Role | Worktree / branch | Depends on | Owned write scope |
| --- | --- | --- | --- | --- |
| baseline | baseline | `/Users/t/Projects/macro/wt-resume-baseline`, detached | none | handoff only; no product edits |
| frontend | build | `/Users/t/Projects/macro/wt-resume-frontend`, `resume/rox-frontend` | none | `apps/web` except generated service clients, `apps/marketing`, `apps/docs`, display assets, frontend tests |
| mailbox | build | `/Users/t/Projects/macro/wt-resume-mailbox`, `resume/rox-mailbox` | none | mail/auth/identity crates and services, migrations, `.sqlx`, `Cargo.lock`, `packages/sdk`, generated service clients |
| enterprise-runtimes | build | `/Users/t/Projects/macro/wt-resume-enterprise`, `resume/rox-enterprise-runtimes` | none | enterprise/agent/runtime/team/document crates and agent harness service; no migrations, `.sqlx`, or `Cargo.lock` |
| review | review | `/Users/t/Projects/macro/wt-resume-review`, detached | none | review handoff only; no product edits |
| integrate | build | `/Users/t/Projects/macro/wt-integration`, `integration/rox-enterprise` | frontend, mailbox, enterprise-runtimes, review | merge accepted owned paths, conflict resolution, integration commit |
| verify | verify | fresh detached worktree at integrated HEAD | baseline, integrate | verification handoff and disposable test artifacts only |

## Execution rules

1. Read the applicable `AGENTS.md`, `CODING.md`, Rust/database/web guides, and package manifests before editing. No `.codegraph/` index exists in these checkouts; use targeted symbol search.
2. Start each bug with the current red command and preserve its exact failure signature. A fix test needs an observed pre-fix red witness; do not relabel failures as expected without a merge-base run or a requirement citation.
3. Cap each Rust lane with `CARGO_BUILD_JOBS=2`; run affected packages rather than three concurrent workspace builds. Do not export `SQLX_OFFLINE` for tests. Keep live local databases and volumes intact.
4. Mailbox owns all migration and `.sqlx` writes and uses `nix develop --command just prepare_db` for workspace metadata. Enterprise-runtimes reports any schema/metadata need in its handoff instead of writing those paths.
5. Frontend owns the Vite investigation. PID 73039 was observed as `node /Users/t/Projects/macro/wt-integration/node_modules/.bin/vite -c vite.config.ts`, cwd `/Users/t/Projects/macro/wt-integration/apps/web`; HTTP `/app/` returned empty and HTTPS failed TLS negotiation. Restart it only after confirming it remains the interrupted task's process.
6. Review receives the original prompts and exact baseline, classifies every criterion pass/fail/unverified, and never edits the product. Producers commit only their owned changes with Conventional Commits.
7. Integration reads every handoff and patch, preserves all accepted requirements, resolves conflicts explicitly, and records unresolved findings rather than hiding them.
8. Verify uses a fresh detached checkout at the final integrated HEAD, reruns requirement-level checks and browser behavior, and returns PASS/HOLD/BLOCK with command, scope, freshness, exit status, and failure origin.

## Evidence and handoff

Each producer returns: objective, base/final SHA, owned changed files, acceptance mapping, exact commands and observed outputs, pre-fix red witnesses, generated-artifact provenance, failed attempts, remaining gaps, and artifact/handoff paths. The parent reads the actual artifacts and reruns integrated checks after any revision change.

No worker may push, deploy, open a PR, call `mail.rox.one`, launch a real model, change global agent configuration, or access credential stores. Local fake servers and disposable test fixtures are allowed.
