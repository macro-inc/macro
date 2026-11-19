# agent_permissions

## What it is

Agent permissions: per agent, which Macro SDK operations its code may call
always, only after a person approves (ask), or never. Stores the settings,
resolves them against `agent_permission_registry`, and serves the HTTP API
(mounted on `agent_harness_service`).

## How it works

- Settings are sparse rows: a group's action (`documents:destroy`) or one
  operation (`storage.delete_document`). An operation's state is its own
  setting, else its group's action, else always. A person's operation
  setting replaces its group's; one the agent made (`via_agent`) only adds
  to it, taking the stricter of the two, so a person's later, stricter group
  setting still applies. A session overlay (an agent's restrictions on itself
  for one session) can only make it stricter.
- Operations marked `always_allowed` in the registry (the agent's own
  tightening) are outside the catalog: always allowed, and no setting can
  name them.
- Owned agents have one policy (`agent_tool_permission`); a built-in persona
  has one per person (`persona_tool_permission`), and in a session the
  owner's applies.
- Tighten-only compares every operation's effective state before and after
  the change (`domain/resolve.rs` `tighten_only`). A tool's `always` is
  saved as clearing its own setting. A state asked for that is looser than
  its target's now is refused (`would_loosen`, `asks_looser`): a tool's
  `always` under a stricter group (not a silent no-op), and removing or
  loosening a group's action even when no operation's state moves today,
  since operations resolving through it later would be looser.
- Expected refusals (off, not found, forbidden, needs a person, would loosen,
  unknown target) log at WARN; only `Internal` logs at ERROR.

## Start here

- `src/domain/service.rs`: who may read, set, tighten, reset; `resolve_calls`
  for a run's gate.
- `src/domain/resolve.rs`: resolution, the view, tighten-only.
- `src/inbound/axum_router.rs`: routes, credential mapping, error codes.
- `src/domain/admission.rs`: `admit`, the OCaml gate's question: every
  operation a program may call sorted into blocked / ask / allowed as
  `GatedOperation`s (an unclassified one is blocked). `ExecutionPermission`
  is what a stopped run's record carries.
- `src/inbound/toolset.rs`: `ShowPermissions`, the direct tool the internal
  MCP offers where permissions gate OCaml; it reads `view_agent` as the
  agent in its session and changes nothing.

## Boundaries

- Depends on: `agent_permission_registry` (the catalog), ports for the
  agents directory (`bots`' manage rule) and sessions, both adapted in
  `agent_harness_service/src/tool_permissions.rs`.
- Used by: `agent_harness_service` (routes, the code-mode gate).

## Checks

- `cargo test -p agent_permissions` (`SQLX_OFFLINE` unset; the `pg` tests
  need a migrated local MacroDB).

## Gotchas

- Group ids and operation keys are stored: renaming one in the registry
  orphans its rows, which then resolve to nothing (always).
- The handler decides nothing: it maps the credential to `Credential` and the
  service applies every rule. Loosening and reset need `PersonSession`.
- With the rollout off for the caller, every route answers 404.

## Related

- Rules: `.agents/rules/rust/db.md` · Registry: `crates/agent_permission_registry`
