# Decisions

Newest first. Each entry: date, decision, reason, who decided.

## 2026-10-30

- **First pass: an entirely independent backend, not wired to Macro.** Connect
  hosts itself (own Pulumi project in `connect/infra`: ECS cluster, ALB, RDS,
  KMS key, Secrets Manager runtime secret; `connect-dev.macro.com` at the host
  root) and is proven with integration tests before Macro integrates. The first
  PR touches none of Macro's deployed services, gateway, deploy pipeline, or
  local stack. Doppler `connect` holds operations credentials only. This
  replaces running on Macro's platform. (Eric)
- **Connect's RDS runs PostgreSQL 17** on `db.t4g.micro` (dev) and
  `db.t4g.small` (prod). Reason: AWS documents those classes for 17, and
  Connect needs nothing from 18. (Claude, answering the T013 builder)
- **Build in vertical slices.** First slice: a dev deploy with a few apps that
  pass a real connect, refresh, and tool call; an app is `live` only after it
  passes conformance, the rest stay `pending`. Infra is provisioned with
  Pulumi, including Connect's own small RDS instance. (Eric)
- **Connect uses runtime-checked SQLx queries,** each exercised by a
  `#[tokio::test]` with Connect's migrations on `template0`, instead of Macro's
  workspace query cache. Reason: Connect has its own database; one
  `DATABASE_URL` cannot serve both at compile time. (Claude)
- **Generated Cargo artifacts are accepted in Connect changes:** hakari adds
  `workspace-hack` to Connect crates and updates `Cargo.lock` and the
  dependency closures. The boundary check exempts `workspace-hack`. (Claude,
  answering the T002 builder)
- **Planner and builder:** Claude Opus 5.5 plans, dispatches, and reviews;
  GPT-6-Sol on the Fast tier (Codex CLI) builds, one task spec per worktree.
  Process in [`building.md`](building.md). (Eric)
- **v1 reuses Macro's existing GitHub and Slack OAuth apps;** Macro Connect
  registers its own later. Their client secrets go into encrypted Connect
  Pulumi config when those apps become live. Connect never reads Macro's
  projects at runtime. Reason: those apps work today; owning them is not on
  the week-one path. (Eric)
- **Microsoft is excluded** from v1. Reason: its MCP servers need Agent 365
  and Copilot licences per user. (Eric)
- **The 451 connections with no first-party MCP are removed at cutover.**
  (Eric)
- **Google is punted:** no Google submission for now; Google connections stay
  on Pipedream, so Pipedream is not cancelled until Google moves. (Eric)
- **Doppler project `connect` exists;** the `connect@macro.com` account
  credentials are `CONNECT_ACCOUNT_EMAIL` and `CONNECT_ACCOUNT_PASSWORD` in
  `prd`. (Eric)
- **Submission records live in `connect/submissions/`** as one Markdown file
  per vendor with tracker frontmatter. Reason: git history audits every change
  and any agent can read them without new infrastructure. (Claude)
- **Macro Connect is its own product in `connect/`, separated as if it were
  another repository**, enforced by ast-grep and a Cargo dependency check.
  Macro consumes it through `connect_client` and `@macro-connect/sdk` only.
  Reason: it will serve other companies; Macro must be an ordinary customer.
  (Eric)
- **The registry lives in Connect, not Macro.** The prototype that put an app
  table in Macro's `mcp_client` (branch `eric/macro-connect-registry`) is
  superseded; mine it for the per-app data and the Linear scope note, then
  delete the branch. (Eric)
- **v1 is MCP only.** Each catalog entry is labelled `MCP` or `MCP + API`; v1
  ships `MCP`. Apps without a first-party MCP server are not in the catalog.
  Reason: Pipedream's wrappers over vendor APIs are the low-quality part of its
  catalog. (Eric)
- **Week-one goal is Macro's own users.** Other companies as customers come
  after. (Eric)
- **Gmail, Drive, and Chat stay on Pipedream until the CASA assessment
  passes**, rather than going through a bridge vendor. (Eric)
- **Eric is the human for attestations, contracts, and the human queue** until
  someone else is named. (Eric)
- **Submission management is agent-run.** Agents read vendor requirements,
  write and file submissions, correspond with reviewers, and track state; the
  human only clears the human queue. (Eric)
- **Catalog entries carry `id`, `name`, `description`, `icon`.** Icons are
  SVGs committed next to `app.toml`; descriptions are written from the
  server's own tool list. (Eric, Claude)
