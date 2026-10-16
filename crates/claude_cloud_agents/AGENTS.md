# claude_cloud_agents

## What it is

Part of agent sessions: a demo-only Claude Code cloud provider that runs
agent sessions against Anthropic's hosted Claude Code using user
subscription OAuth, via the Agent Client Protocol.

## Start here

- `src/domain/service.rs` + `src/domain/ports.rs`: provider-independent session
  behavior and the ports a cloud agent provider must implement.
- `src/domain/auth.rs` + `src/outbound/oauth.rs`: owner-bound interactive OAuth flow.
- `src/inbound/acp.rs`: Agent Client Protocol adapter driving sessions.
- `src/domain/translate.rs`: translating between ACP and the hosted Claude API shape.
- `src/outbound/credentials.rs` + `src/outbound/postgres.rs`: credential storage.
- `examples/smoke.rs`: a runnable end-to-end smoke test of the flow.

## Scope

- Owns: the demo Claude Cloud provider — auth, MCP gateway access, and
  ACP session translation for hosted Claude Code.
- Not here: other agent providers or the provider-agnostic harness →
  `crates/agent_harness`.

## Boundaries

- Depends on: `agent-client-protocol`, `agent_runtime_protocol`, `cursor_api_key`,
  `macro_authorization` (feature `axum`).
- Used by: `agent_harness`.

## Recipes

- Add a session capability: `src/domain/ports.rs` → `src/domain/service.rs` →
  `src/inbound/acp.rs` → `src/domain/translate.rs` if the wire shape changes.

## Checks

- `cargo test -p claude_cloud_agents` (`SQLX_OFFLINE` unset).

## Gotchas

- Model discovery goes through the models API, not a hardcoded Fable/Claude
  list (#6595) — don't reintroduce a hardcoded model set.
- The MCP gateway and hosted browser sign-in need explicit allowances in the
  cloud environment; don't assume the same network access as local agents
  (#6550, #6529).

## Related

- Rules: `.agents/rules/rust/architecture.md`
