# Macro Connect

A separate product that lives in Macro's monorepo: first-party, OAuth-only
access to vendors' own MCP servers, run by agents. Macro is its first customer.
The plan is [`docs/plan.md`](docs/plan.md).

## Start here

1. [`STATUS.md`](STATUS.md): what is done, in flight, blocked on the human, and
   next. Update it before you stop.
2. [`docs/plan.md`](docs/plan.md): guarantees, scope, architecture, schedule.
3. [`docs/decisions.md`](docs/decisions.md): settled questions; reopen one only
   with new facts.

Taking over as project manager: run the `connect-pm` skill. Planner and builder
roles are in [`docs/building.md`](docs/building.md).

## Map

| Path | Contents |
| --- | --- |
| `registry/apps/<id>/` | One app per directory: `app.toml` and `icon.svg`. The catalog's source of truth; spec in [`docs/catalog.md`](docs/catalog.md). |
| `submissions/` | One record per vendor OAuth app submission; process in [`docs/submissions.md`](docs/submissions.md). |
| `crates/` | Rust crates, all named `connect_*`. `connect_client` is the public client. |
| `services/` | Deployable services; `connect_api` first. |
| `packages/` | TypeScript packages; `@macro-connect/sdk` is the public web SDK. |
| `docs/` | Plan, decisions, catalog spec, probing, submissions, research, and deployment runbooks. |
| `tasks/` | One spec per builder task, with its Result; process in [`docs/building.md`](docs/building.md). |
| `tooling/` | `dispatch.sh` runs a builder on a task spec; `builder-brief.md` is its shared prompt. |
| `.agents/skills/` | Workflows: `connect-pm`, `connect-add-app`, `connect-submission`. `.claude/skills` symlinks here. |

## Boundary

Build Macro Connect as if it were its own repository.

- Connect code depends only on `connect_*` crates, `@macro-connect/*`
  packages, and third-party libraries. Copy a Macro helper into `connect/`
  rather than importing it.
- Macro depends only on `connect_client` (Rust) and `@macro-connect/sdk`
  (web), as any customer would. Macro never reads Connect's database,
  Doppler project, or internals.
- Connect has its own database, Doppler project, deploy stack, and secrets.
- Enforced by ast-grep rules `connect-*` in `rules/ast-grep/` and, once built
  (day 1 in the plan), a Cargo dependency check. A failing boundary check
  means the design is wrong, not the rule.

## Rules for agents

- Probe before you classify: a server's client registration (CIMD, DCR, or
  Macro Connect's own app) comes from its live OAuth metadata
  ([`docs/probing.md`](docs/probing.md)), never from docs alone.
- Only vendors' own MCP servers enter the registry.
- Steps only the human can take go to the human queue in `STATUS.md`, batched:
  legal attestations and terms acceptance, identity checks, payments, 2FA and
  CAPTCHAs, deploys, production access. Prepare everything around them so the
  human's part is one sitting.
- Vendor client secrets go into Doppler project `connect-api` (runtime) with
  `doppler secrets set`; never print, log, or commit them.
- Vendor correspondence goes out from `connect@macro.com` only, and is logged
  in the vendor's submission record.
- Record every decision the human makes in `docs/decisions.md`, dated, with the
  reason.

Macro's root `CLAUDE.md` rules (commits, checks, production, deploys) apply
here too.

## Checks

- `just check`: runs the `connect-*` boundary rules with the rest.
- `cargo x deps --check`: enforces the Rust crate boundary (including normal,
  dev, and build dependencies) and checks generated dependency artifacts.
- Run per-crate tests for each changed Connect crate.

## Gotchas

- Advertised DCR is not permission: Figma and Vercel reject unapproved
  clients anyway. Probing step 6 catches these.
- A probe proves metadata, not a working connection; only conformance does.
- Users connected through Pipedream's own OAuth apps cannot be exported; every
  migrated user reconnects.
