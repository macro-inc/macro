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
  setting replaces its group's; one any other credential made (the agent,
  an API key: `restriction_only`) only adds to it, taking the stricter of the
  two, so a person's later, stricter group setting still applies.
  `via_agent` is only the "set by the agent" label (`SetBy`). A session
  overlay (an agent's restrictions on itself for one session) can only make
  it stricter.
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
  for a run's gate, which reads the saved rules and the session overlay in
  one snapshot (`rules_with_session`), never as two reads a write can fall
  between.
- `src/domain/resolve.rs`: resolution, the view, tighten-only.
- `src/inbound/axum_router.rs`: routes, credential mapping, error codes.
- `src/domain/admission.rs`: `admit`, the gate's question: every
  operation a program may call sorted into blocked / ask / allowed as
  `GatedOperation`s (an unclassified one is blocked). `ExecutionPermission`
  is what a stopped run's record carries.
- `src/inbound/toolset.rs`: `ShowPermissions`, the direct tool the internal
  MCP offers where permissions gate the session's programs (JS tools); it
  reads `view_agent` as the agent in its session and changes
  nothing.

## Rollout: one flag

Everything agent permissions and JavaScript tools (`js_tools`) programs add is
behind `enable-agent-permissions`, backend and web. Off, or unreadable (no
PostHog client, a failed load: `code_mode::flags_on` in the harness,
`useFeatureFlag` on the web), behaviour is exactly what it was before them.
The backend
reads the session owner's flag (the caller's for the HTTP routes); the web
reads the viewer's. A new surface goes in this table with its flag-off test.

| Surface | Gate | Off | Flag-off test |
| --- | --- | --- | --- |
| Routes `/agent-tool-permissions/catalog`, `/agents/{id}/tool-permissions[/tighten]`, `/agent-sessions/{id}/tool-permissions` | `AgentPermissionsService::ensure_enabled` (`PermissionsRollout`) | 404 | `every_route_is_not_found_while_the_feature_is_off`, `with_the_rollout_off_everything_is_disabled` |
| `ExecuteCode` `language: "js_tools"` (schema, `js_tools.md` and `js_tools_permissions.md` text, the call) | `session_toolset`, `CodeModeService::execute` (`JsToolsRollout`) | today's tool, pinned by `toolset/test/without_js_tools.json`; a `js_tools` call refused before a credential | `sessions_see_and_call_js_tools_only_with_the_rollout`, `js_tools_without_the_rollout_is_refused_before_a_credential` |
| The gate: analysis, never, ask holds, `allowed_operations` | `PermissionGate::check` (`LanguageRollout`) | `None`: the run is unchanged; a JS tools program it did not check is refused unrun | `javascript_and_owners_without_the_rollout_are_not_checked`, `each_language_is_checked_only_with_its_own_rollout_and_analyzer`, `the_gate_follows_the_permissions_flag` |
| `macro-sdk` holds (`PermissionApprovals`, standing approvals, `by_person`), fold `approver`, record `permission`, `refused` activity | made only by the gate | never made; absent fields serialize as before | the gate's tests above |
| `ShowPermissions` (internal MCP list and call) | `InternalTools::permission_tools` (`permissions_enabled`) | not listed; a call is refused | `execute_code_offers_and_accepts_js_tools_only_with_permissions`, `show_permissions_is_offered_only_where_permissions_gate_js_tools` |
| Web flag | `enableAgentPermissions` (`featureFlags.ts`, `default: LOCAL_ONLY \|\| undefined`) | on only under local HMR or a `just stack` bundle; dev and prod follow PostHog alone, and unreachable PostHog is off | `use-agent-permissions-flag.test.ts` (the hook; vitest runs with `import.meta.hot`, so the default itself can't be tested there) |
| Web: editor section, Macro's shield, permissions page, `requestAgentPermissions` links | `Agents.tsx` (`useAgentPermissionsFlag`, `useAgentPermissionsAvailable`) | hidden; an open page closes; a link waits | `Agents.test.tsx` (`permissions`) |
| Web: ShowPermissions card | `ShowPermissionsPart` | a plain row, nothing read | `ShowPermissionsPart.test.tsx` |
| Web: blocked card | `BlockedPermissionsNotice` | the card without Review permissions, nothing read | `blocked-permissions-notice.test.tsx` |
| Web: approval card | `PermissionApprovalRequest` | still answerable (a run waits on it), no permissions link, nothing read | `PermissionApprovalRequest.test.tsx` |
| Web: declined row, Blocked step, answered-hold row | `CodeExecutionPart`, `CodeExecutionToolCall`, `ToolApprovalPart` | data only a gated run makes | — |

Not flagged, by design: the migrations (tables), the registry
(`agent_permission_registry`, data), the reserved `macro-sdk` app slug
(`McpServerSlug`: no connected app may take it, so a hold can't be spoofed),
the tool-permission routes in the correlation `SENDS` list (they 404 when
off), the tool-approval answer route's caller check (`by_person`, which
only a `macro-sdk` hold reads), the OpenAPI schemas and generated clients,
and the public SDK's (`packages/sdk`) methods and its bundle in code mode,
which call routes that answer 404 while the flag is off. The SDK methods
carry `@flag enable-agent-permissions`, which leaves them out of the SDK MCP
tools (`packages/sdk-mcp`, pinned by its `flagged` test) and of the SDK
reference and code mode's docs that `DescribeCodeTools` and `ReadCodeDocs`
show (`packages/sdk-docs`, pinned in it and in `packages/code-mode-sdk`); the
JS tools catalog, offered only with the flag, keeps the operations. Remove
the tags when the flag goes.

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
