# cla-worker

Cloudflare Worker that collects and looks up Macro CLA signatures. Together
with the `cla.yml` GitHub workflow (generated from
`tooling/xtask/crates/xtask_workflows/src/workflows/cla.rs`) it enforces the
CLA policy on `macro-inc/macro` pull requests.

## What it does

- `GET /cla` — serves [CLA.md](CLA.md) with a "Sign with GitHub" link.
  `?signed=1` renders the post-signature confirmation (the signer's receipt).
- `GET /cla/callback` — GitHub OAuth callback. Exchanges the code, reads the
  signer's public identity (`{ id, login }`), inserts a signature row, and
  redirects to the confirmation page. The OAuth token is requested with zero
  scopes, used for exactly one API call, and never stored.
- `GET /cla/check?github_id=<int>` — `Authorization: Bearer <CHECK_API_KEY>`
  gated lookup used by the enforcement Action. Returns
  `{ "signed": true, "version": "…" }` / `{ "signed": false, "version": null }`.
- Weekly cron — dumps the full `signatures` table as JSON to R2 under
  `cla-signatures/YYYY-MM-DD.json`, so the evidence never lives solely in D1.

## The store

One append-only D1 table, keyed on `(github_id, cla_version)`. `github_id` is
GitHub's immutable numeric user ID — never the login, which is mutable and
recyclable. Rows are never mutated or deleted; re-signing the same version is
an idempotent no-op (`INSERT OR IGNORE`), and signing a new version is a new
row.

## Versioning the CLA text

`CLA_VERSION` (wrangler.jsonc) is a date tag bumped only when CLA.md changes
materially. Never edit CLA.md without bumping — the check must never claim
someone agreed to words they didn't see. Whether pre-bump signatures still
satisfy `/cla/check` is a policy decision made at bump time: the check query
in `src/index.ts` is strict (current version only) by default; widen it to a
`cla_version IN (...)` allowlist to grandfather old versions or manually
inserted `ccla:<company>` rows.

## One-time setup

1. `wrangler d1 create macro-cla` and put the returned `database_id` in
   wrangler.jsonc, then `wrangler d1 migrations apply macro-cla --remote`.
2. `wrangler r2 bucket create macro-cla-exports`.
3. Create a GitHub **OAuth App** (not a GitHub App) under the macro-inc org
   with callback URL
   `https://macro-cla.macroverse.workers.dev/cla/callback`. Put the client ID
   in wrangler.jsonc (`GITHUB_CLIENT_ID`); `wrangler secret put
   GITHUB_CLIENT_SECRET`.
4. `wrangler secret put CHECK_API_KEY` with a long random value, and store
   the same value as the `CLA_CHECK_API_KEY` repo secret in `macro-inc/macro`.
5. Optionally set a `CLA_ORG_READ_TOKEN` repo secret (a `read:org` token) so
   the Action can see *private* org members; without it only public members
   are exempt from signing.
6. `bun run deploy` (or push to `main` — `deploy_cla_worker.yml` is
   path-gated on this directory). The deploy script applies pending D1
   migrations first.
7. In branch protection on `main`, mark the `cla` commit status as a required
   check.

> **Legal review**: CLA.md is a standard Apache-ICLA-derived draft. Have it
> reviewed by counsel before pointing real contributors at it; if the text
> changes, bump `CLA_VERSION` in the same commit.

## Hosting

Served at `https://macro-cla.macroverse.workers.dev` like the account's other
workers — the macro.com DNS zone is on Route 53, so a Cloudflare custom
domain isn't available. If the worker ever moves to a vanity host, update
together: the OAuth app callback URL, `WORKER_ORIGIN` in
`tooling/xtask/crates/xtask_workflows/src/workflows/cla.rs` (then regenerate
workflows), CONTRIBUTING.md, and this file. The signature store is
unaffected by a host move.

## Development

```
bun install
bun run check   # typecheck
bun run dev     # local dev (uses a local D1/R2 simulacrum)
```
