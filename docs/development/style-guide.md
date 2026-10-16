# Code review style guide

Code conventions are agent rules in [`.agents/rules/`](../../.agents/rules/). Agents
load each file when they touch matching paths; reviewers and CodeRabbit read the
same files. This page explains the scheme and indexes the rule files.

**Check locally.** `just check` is the single gate: format, lint, and code rules,
scoped to your changes against `origin/main`, with every finding printed as
`file:line [rule-id]` and the command that fixes it. `just check full` adds `tsc`
and clippy. Mechanically enforceable rules live in [`rules/ast-grep/`](../../rules/ast-grep/).

## IDs

Each rule has a stable ID: `CS-##` for the Rust backend, `FE-##` for frontend and
shared TypeScript. Cite IDs in reviews ("see CS-30"). Never renumber or reuse an
ID; deletions leave gaps and new rules take the next free number. A rule line reads
`<id> rule`, optionally followed by how it is enforced.

## Rule files

| File | IDs | Applies to |
| --- | --- | --- |
| [`config-and-service-urls.md`](../../.agents/rules/config-and-service-urls.md) | CS 14–18 | Everywhere |
| [`CODING.md`](../../CODING.md) | CS 24, 26, 28, 29, 32–35, 71 | Everywhere; read before writing code |
| [`observability.md`](../../.agents/rules/observability.md) | | Everywhere |
| [`rust/guardrails.md`](../../.agents/rules/rust/guardrails.md) | | Backend: tests, migrations, crate boundaries |
| [`rust/db.md`](../../.agents/rules/rust/db.md) | CS | Migrations, SQL, DB clients, outbound adapters |
| [`rust/architecture.md`](../../.agents/rules/rust/architecture.md) | CS | Rust |
| [`rust/code.md`](../../.agents/rules/rust/code.md) | CS | Rust |
| [`rust/libraries.md`](../../.agents/rules/rust/libraries.md) | CS 56–67 | Rust and `Cargo.toml` |
| [`rust/security.md`](../../.agents/rules/rust/security.md) | CS | Rust |
| [`web/data.md`](../../.agents/rules/web/data.md) | FE | `apps/web`, `packages` |
| [`web/solid.md`](../../.agents/rules/web/solid.md) | FE | `apps/web`, `packages` |
| [`web/architecture.md`](../../.agents/rules/web/architecture.md) | FE | `apps/web`, `packages` |
| [`web/libraries.md`](../../.agents/rules/web/libraries.md) | FE 35–46 | `apps/web`, `packages` |
| [`web/ui.md`](../../.agents/rules/web/ui.md) | FE | `.tsx` |
| [`web/mobile.md`](../../.agents/rules/web/mobile.md) | | `apps/web` UI and CSS on touch and phones |
| [`web/ui-primitives.md`](../../.agents/rules/web/ui-primitives.md) | | `apps/web/src/components/ui` |
| [`web/startup-bundle.md`](../../.agents/rules/web/startup-bundle.md) | | `apps/web/src` |
| [`web/lexical-nodes.md`](../../.agents/rules/web/lexical-nodes.md) | | Lexical nodes and decorators |
| [`infra/pulumi.md`](../../.agents/rules/infra/pulumi.md) | | `infra/`, deploy config |

To find a rule by ID: `rg 'CS-30' .agents/rules`. To add one, use the
[rule template](../../.agents/templates/rule.md); an ID-bearing rule goes in the
file for its scope with the next free number.
