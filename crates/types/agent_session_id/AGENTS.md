# agent_session_id

## What it is

Part of agent sessions: `AgentSessionId`, the identity of an agent session,
and `ReplicaId`/`ManagerFence`, the harness replica that manages a live session
and the fencing token its writes carry.

## Scope

- Owns: the id newtypes, their string forms (`FromStr`/`Display`) and serde
  form (a transparent uuid).
- Not here: the session log and its frames → `crates/folds/agent_fold`; session
  ownership, claims and storage → `crates/agent_session`. Both re-export these
  types from their old paths (`agent_fold::domain::log`,
  `agent_session::domain::model`).

## Boundaries

- Depends on: `macro_uuid`, serde, thiserror.
- Used by: `agent_fold`, `agent_session`, `agent_preview`, `codex_cloud_agents`.

## Gotchas

- Must stay wasm-safe: the fold runs in the browser. It is a hakari traversal
  exclude, so it has no `workspace-hack` dependency.
- Depend on this crate, not `agent_session`, when a crate only needs the ids.
