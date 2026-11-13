# GitHub API fixtures

Recorded from the public `macro-inc/macro` repository on 2026-11-13 for the
GitHub adapter's contract tests (`src/outbound/github/test.rs`). Each keeps
only the fields the adapter reads; no author names or emails.

| File | Request |
| --- | --- |
| `commit-squash-10651.json` | `GET /repos/macro-inc/macro/commits/a5502355…` (message cut to its subject) |
| `pull-request-10651.json` | `GET /repos/macro-inc/macro/pulls/10651` |
| `pull-request-10651-commits.json` | `GET /repos/macro-inc/macro/pulls/10651/commits?per_page=100&page=1` |
| `blame-app-build.json` | GraphQL blame of `apps/web/src/features/settings/app-build.ts` at the squash commit |
