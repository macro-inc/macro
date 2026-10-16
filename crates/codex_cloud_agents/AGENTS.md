# codex_cloud_agents

## What it is

Part of agent sessions: Codex cloud transport and ACP conversations —
OAuth/credentials, the OpenAI cloud-task HTTP client, and the ACP adapter
used by both the `codex-acp` binary and `codex_connection`'s hosted
sessions.

## Start here

- `src/domain.rs` + `src/domain/cloud.rs`, `src/domain/journal.rs`: provider-
  independent vocabulary (`Launch`, `TurnId`, `CloudId`) and the journal port.
- `src/domain/acp_session.rs`: the ACP session service tying a prompt to a
  cloud turn.
- `src/outbound/openai.rs` + `src/outbound/openai/tasks.rs`: the OpenAI cloud-
  task HTTP client and its streaming adapter.
- `src/inbound/acp.rs`: ACP protocol adapter (citations, session updates).
- `src/main.rs` / `src/bin/codex_acp.rs`: two composition roots — a direct-
  OAuth probe CLI and the stdio ACP binary for Zed.

## Scope

- Owns: Codex cloud OAuth/credentials for the standalone probe, the OpenAI
  cloud-task client, ACP translation, and (behind the `postgres` feature) a
  Postgres-backed session journal.
- Not here: owner-bound connection storage and KMS encryption for hosted
  sessions → `crates/codex_connection`.

## Boundaries

- Depends on: `agent_runtime_protocol`, `agent-client-protocol`.
- Used by: `codex_connection`, `agent_harness`, `authentication_service`,
  `agent_harness_service`.

## Recipes

- Add an OpenAI cloud-task endpoint: `src/outbound/openai/tasks.rs` →
  `src/outbound/openai/tasks/stream.rs` (if streamed) → `src/domain/cloud.rs`
  (if it changes the domain vocabulary).
- Change ACP translation (citations, message shaping): `src/inbound/acp.rs` →
  `src/inbound/acp/citations.rs` → its `test.rs`/snapshots.

## Checks

- `cargo test -p codex_cloud_agents` (`SQLX_OFFLINE` unset).
- With Postgres journal: `cargo test -p codex_cloud_agents --features postgres`.

## Gotchas

- `#![deny(missing_docs)]`: every public item needs a doc comment.
- `postgres_journal` only compiles under the `postgres` feature, which pulls
  in `agent_session` and `sqlx` — don't add a plain `sqlx` dependency outside
  that feature gate.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
