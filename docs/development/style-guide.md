# Code review style guide

Code conventions are agent rules in [`.agents/rules/`](../../.agents/rules/). Agents
load each file when they touch matching paths; reviewers and CodeRabbit read the
same files. This page explains the scheme and indexes the rule files.

**Check locally.** `just check` is the single gate: format, lint, code rules,
and a PII scan of added lines, scoped to your changes against `origin/main`, with
every finding printed as `file:line [rule-id]` and the command that fixes it.
`just check full` adds `tsc`
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
| [`checks.md`](../../.agents/rules/checks.md) | | Adding a lint, code rule or CI check: `tooling/`, `rules/ast-grep/`, linter configs, workflows |
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
| [`web/design-system.md`](../../.agents/rules/web/design-system.md) | FE 60–68 | `apps/web` `.tsx`: control roles, header layout, selected state, overlay surfaces, loading skeletons |
| [`web/mobile.md`](../../.agents/rules/web/mobile.md) | | `apps/web` UI and CSS on touch and phones |
| [`web/ui-primitives.md`](../../.agents/rules/web/ui-primitives.md) | | `apps/web/src/components/ui` |
| [`web/startup-bundle.md`](../../.agents/rules/web/startup-bundle.md) | | `apps/web/src` |
| [`web/i18n.md`](../../.agents/rules/web/i18n.md) | | `apps/web/src` user-visible text in new UI, menus, and navigation |
| [`web/lexical-nodes.md`](../../.agents/rules/web/lexical-nodes.md) | | Lexical nodes and decorators |
| [`infra/pulumi.md`](../../.agents/rules/infra/pulumi.md) | | `infra/`, deploy config |

To find a rule by ID: `rg 'CS-30' .agents/rules`. To add one, use the
[rule template](../../.agents/templates/rule.md); an ID-bearing rule goes in the
file for its scope with the next free number.

## Email backend boundary checks

The email-specific ast-grep rules enforce the [backend boundaries](../architecture/email-backend.md)
without changing the severity or scope of the workspace's legacy rules.

| Rule | Checks |
| --- | --- |
| [`email-domain-no-concrete-io`](../../rules/ast-grep/email-domain-no-concrete-io.yml) | Domain references to concrete clients, adapter modules and environment access. |
| [`email-inbound-no-concrete-io`](../../rules/ast-grep/email-inbound-no-concrete-io.yml) | Concrete I/O in HTTP handlers, crate inbound adapters and delivery processors. |
| [`email-inbound-no-raw-state-access`](../../rules/ast-grep/email-inbound-no-raw-state-access.yml) | Raw client fields and local client calls in inbound processing. |
| [`email-worker-no-runtime-io`](../../rules/ast-grep/email-worker-no-runtime-io.yml) | Concrete I/O in worker/context files outside startup composition. |
| [`email-worker-no-raw-state-access`](../../rules/ast-grep/email-worker-no-raw-state-access.yml) | Raw worker-context fields and raw client use outside `context()`. |
| [`email-outbound-no-inbound-host`](../../rules/ast-grep/email-outbound-no-inbound-host.yml) | Outbound dependencies on API/pubsub implementations. |

These are error-level rules. Their notes list the composition, transport,
legacy type and helper exceptions. Keep exceptions narrow and cover both the
permitted syntax and a nearby forbidden case in
[`rules/ast-grep-tests`](../../rules/ast-grep-tests).

When changing these rules, run the native fixtures and scan their source scope
from the repository root:

```sh
bunx --yes @ast-grep/cli@0.44.1 test
bunx --yes @ast-grep/cli@0.44.1 scan --filter '^email-' services/email_service/src crates/email/src
```

The fixtures include expected match locations and are discovered through
`sgconfig.yml`. Root `just check` scans changed source files; changing only a rule
file does not replace the native tests or a source scan. The Conventions workflow
uses the same rule directory. Syntax guards complement domain-policy review;
they do not resolve arbitrary Rust aliases or prove the contents of adapters.
