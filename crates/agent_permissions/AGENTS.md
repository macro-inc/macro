# agent_permissions

## What it is

Agent permissions: per agent, which Macro SDK operations its code may call
always, only after a person approves (ask), or never. Stores the settings,
resolves them against `agent_permission_registry`, and serves the HTTP API
(mounted on `agent_harness_service`).

## How it works

- Settings are sparse rows: an action's default (`Target::Action`, stored
  `action` / `send`), a group's exception to it (`group_action` /
  `documents:destroy`) or one operation (`tool` / `storage.delete_document`).
  A group's action is its exception, else the action's default, else
  always; an operation's state is its own setting, else its group's action.
  A new group has no exceptions, so it follows every default; so does a pair
  no operation maps to yet. A person's exception or operation setting
  replaces what it sits under; one any other credential made (the agent, an
  API key: `restriction_only`) only adds to it, taking the stricter of the
  two, so a person's later, stricter default or group setting still applies.
  `via_agent` is only the "set by the agent" label (`SetBy`). A session
  overlay (an agent's restrictions on itself for one session, any of the
  three kinds) can only make it stricter. Wire names stay `always/ask/never`
  and `update`/`destroy`; the catalog names them Edit and Delete and lists
  actions in `Action::DISPLAY` order (Read, Create, Edit, Send, Delete).
- Writes (`resolve::normalize`): a default of `always` is never stored (a
  removal); a person's exception is kept in any state, an explicit Allow and
  one equal to the default included, until `null` removes it; a restriction
  (a tightening, an overlay) never stores `always` at all. Before action
  defaults, no `action` rows existed and `group_action` never held `always`,
  so every earlier rule set resolves exactly as before
  (`existing_rule_sets_resolve_exactly_as_before`, against a copy of the old
  resolver).
- Operations marked `always_allowed` in the registry (the agent's own
  tightening) are outside the catalog: always allowed, and no setting can
  name them.
- Every policy has a stable id (`PolicyId`, `agent_permission_policy`; the
  view's `policyId`), and its settings are rows under that id
  (`agent_permission_rule`). Owned agents have one policy; a built-in persona
  has one per person, and in a session the owner's applies.
  `PermissionStore::ensure_policy` creates a policy's row on first use (in the
  gate, before its read-only snapshot), and only after the request passed
  its access checks. `agent_tool_permission` and `persona_tool_permission`
  are the tables from before ids, copied by migration `20261122220100` and no
  longer read; a cleanup after release drops them.
- An owned agent's policy may follow another policy, its source
  (`agent_permission_policy.follows`, `source_policy_id`; migration
  `20261122233513`), kept by id: a `PolicyChain` of at most `MAX_CHAIN` (5)
  policies, never a cycle. It resolves through the chain on every call
  (`resolve::Resolver`): the root (a policy owning its settings) resolves as
  above, or asks for everything when its source was hard deleted (`Lost`:
  `follows` with no source); each following level's rows, the policy's own
  included, only restrict (stricter-of), whoever made them; the overlay comes
  last. A state the chain gave from a source has `Origin::Source`. Persona
  (and, later, team) policies are roots. A soft-deleted agent's policy stays
  and keeps applying, frozen. The store reads a chain and its rules in one
  statement, and the gate reads it with the overlay in one snapshot
  (`chain_with_session`), so a source edit, a source change or a detach is
  seen entirely or not at all.
- Every change to any source (`set_source`, `detach`) takes one global
  advisory lock (`agent_permission_policy:sources`) before the policy's lock,
  then checks, under it, that the source's chain doesn't reach the policy
  (`source_cycle`) and that the policy's longest follower path plus the
  source's chain stays within `MAX_CHAIN` (`source_too_deep`); concurrent
  A→B and B→A can't both pass. Following, when the policy owned its
  settings, drops its person-made rows and keeps its restrictions as local
  ones. Detach (`resolve::materialize`) replaces its rows with the snapshot
  of what the chain resolves to (every default, every pair including hidden
  ones and groups only rows name, every catalog operation; explicit choices
  stay explicit, local restrictions stay restrictions; session overlays and
  approvals are not copied), in one transaction.
- Who may follow what (`service.rs` `in_scope`): a private agent its owner's
  own Macro policy, their other private agents and the agents of teams they
  belong to; a team agent its team's other agents. Never a person's policy
  for a team agent, a persona other than Macro, or a deleted agent's policy
  (one already followed stays, frozen). Setting a source and detaching need
  a person who may edit the follower (`NeedsPerson` otherwise); neither
  gives any authority over the source, whose own routes check its own
  owner. A person's `set` on a follower may not ask for a state looser than
  the source gives (`follows_source`, 409, naming the source and the
  operations): its rows only restrict. Reset deletes the follower's own rows
  and keeps following. The view says what it follows (`source`: identity,
  scope, `live`/`deleted`/`lost`, `inScope` (false once an ownership or
  membership change would no longer offer it), the caller's own `canEdit`,
  and the rest of the chain in `via`) and what it inherits (`inherited`,
  read only); `canSetSource` says whether the caller may change it. The
  picker (`/agent-tool-permissions/sources`) lists the person's own Macro
  first (private scope), then the agents in scope (at most
  `MAX_CANDIDATES`), marking the current one and those that would make a
  cycle or a chain too long. `ShowPermissions` says "Follows <name>
  (@handle)" (`follows`).
- Tighten-only compares, before and after the change, every operation's
  effective state, every catalog group's every action (hidden pairs too) and
  every action's default (`domain/resolve.rs` `tighten_only`); a change that
  loosens only a pair or a default is refused naming no operation. A tool's
  `always` is saved as clearing its own setting. A state asked for that is
  looser than its target's now is refused (`would_loosen`, `asks_looser`): a
  tool's `always` under a stricter group (not a silent no-op), loosening a
  group's action or removing it (which asks for the default) even when no
  operation's state moves today, and lowering or removing a default (which
  asks for always), since operations resolving through them later would be
  looser.
- The view carries the five `defaults` (display order) and, per listed
  pair, `exception` (this policy saved one, whatever its state). It lists a
  group's action only when an operation maps to it, and a
  group only when it has one (`resolve::view`); `ShowPermissions` shows
  only those, plus every default. A saved rule on a hidden pair stays in `rules` and applies as
  soon as the registry maps an operation there: resolution never reads the
  view. `restricted` counts operations, so hidden rules don't change it.
- Expected refusals (off, not found, forbidden, needs a person, would loosen,
  unknown target, a source refused) log at WARN; only `Internal` logs at
  ERROR.

## Start here

- `src/domain/service.rs`: who may read, set, tighten, reset; `resolve_calls`
  for a run's gate, which reads the policy's chain and the session overlay in
  one snapshot (`chain_with_session`), never as two reads a write can fall
  between.
- `src/domain/resolve.rs`: resolution, the view, tighten-only;
  `resolve/chain.rs`: resolution through a chain and `materialize`.
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
| Routes `/agent-tool-permissions/catalog`, `/agent-tool-permissions/sources`, `/agent-tool-permissions/policies/{id}`, `/agents/{id}/tool-permissions[/tighten\|/source\|/detach]`, `/agent-sessions/{id}/tool-permissions` | `AgentPermissionsService::ensure_enabled` (`PermissionsRollout`) | 404 | `every_route_is_not_found_while_the_feature_is_off`, `with_the_rollout_off_everything_is_disabled` |
| The turn's code-mode kind (`CodeModeKind`, once per turn) and the dialect `ExecuteCode` it picks (no `language`: `source` the dialect, optional TypeScript `module` with no network; schema, `js_tools.md` and `js_tools_permissions.md` text, the call; on with the flag, TypeScript is refused) | `CodeModeService::code_mode_kind` (`JsToolsRollout`), `session_toolset(kind)`, `refuse_other_kind`, the in-process agent's `TurnCodeTools` | `TypeScript`: today's tool, pinned by `toolset/test/without_js_tools.json`; a dialect call or a module refused before a credential | `sessions_see_and_call_js_tools_only_with_the_rollout`, `js_tools_without_the_rollout_is_refused_before_a_credential`, `sessions_without_javascript_tools_see_todays_tools` |
| Public MCP code tools for an agent session's calls (`ManagedAgentSession`) | `CodeModeSurface::kinds` (the same `CodeModeKinds`) | listed and run as today | `a_dialect_sessions_calls_get_no_typescript_code_mode` |
| The gate: analysis, never, ask holds, `allowed_operations` | `PermissionGate::check` (`LanguageRollout`) | `None`: the run is unchanged; a JS tools program it did not check is refused unrun | `javascript_and_owners_without_the_rollout_are_not_checked`, `each_language_is_checked_only_with_its_own_rollout_and_analyzer`, `the_gate_follows_the_permissions_flag` |
| `macro-sdk` holds (`PermissionApprovals`, standing approvals, `by_person`), fold `approver`, record `permission`, `refused` activity | made only by the gate | never made; absent fields serialize as before | the gate's tests above |
| `ShowPermissions` (internal MCP list and call) | `InternalTools::permission_tools` (a `Dialect` turn, `CodeModeKind`) | not listed; a call is refused | `execute_code_offers_and_accepts_js_tools_only_with_permissions`, `show_permissions_is_offered_only_where_permissions_gate_js_tools` |
| Server refusals that say how to proceed in code (email send, schedule and calendar-event forward, calendar create, bot token mint, outside chat send) | `macro_authorization::from_dialect_program`: only a JS tools run's `x-macro-code-execution: js_tools` | today's text, byte for byte | `a_refusal_names_the_operations_of_the_programs_code_mode`, `a_create_refusal_names_the_operations_of_the_programs_code_mode`, `a_mint_refusal_names_the_operations_of_the_programs_code_mode`, `a_dialect_programs_refusal_names_its_operation` |
| Web flag | `enableAgentPermissions` (`featureFlags.ts`, `default: LOCAL_ONLY \|\| undefined`) | on only under local HMR or a `just stack` bundle; dev and prod follow PostHog alone, and unreachable PostHog is off | `use-agent-permissions-flag.test.ts` (the hook; vitest runs with `import.meta.hot`, so the default itself can't be tested there) |
| Web: Permissions on Your agents rows (inline panel), the editor's Permissions section, `requestAgentPermissions` links | `Agents.tsx` (`useAgentPermissionsFlag`, `useAgentPermissionsAvailable`) | hidden; an open panel closes; a link waits | `Agents.test.tsx` (`permissions`) |
| Web: ShowPermissions card | `ShowPermissionsPart` | a plain row, nothing read | `ShowPermissionsPart.test.tsx` |
| Web: blocked card | `BlockedPermissionsNotice` | the card without Review permissions, nothing read | `blocked-permissions-notice.test.tsx` |
| Web: approval card docked above the composer | `PermissionApprovalRequest` | still answerable (a run waits on it), no Edit permissions, nothing read | `PermissionApprovalRequest.test.tsx` |
| Web: denied row, Blocked step | `CodeExecutionPart`, `CodeExecutionToolCall` | data only a gated run makes | — |

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
  agents directory (`bots`' manage rule, an agent's owner and identity, the
  agents a person may edit) and sessions, both adapted in
  `agent_harness_service/src/tool_permissions.rs`.
- Used by: `agent_harness_service` (routes, the code-mode gate).

## Checks

- `cargo test -p agent_permissions` (`SQLX_OFFLINE` unset; the `pg` tests
  need a migrated local MacroDB).

## Gotchas

- Group ids and operation keys are stored: renaming one in the registry
  orphans its rows, which then resolve to nothing (always). Moving operations
  to another group takes a migration copying the old group's `group_action`
  rows (both policy tables and the session overlay), as
  `20261122220000_agent_tool_permission_channel_admin.sql` did for
  `channel_admin`.
- The session overlay's kind and target checks were widened for `action`
  NOT VALID (`20261122224406`) and validated in their own migration
  (`20261122224441`).
- A chain longer than `MAX_CHAIN` or a cycle can only come from hand-edited
  rows; reading one is an error (`ChainError`), and the gate then refuses
  the run.
- The handler decides nothing: it maps the credential to `Credential` and the
  service applies every rule. Loosening and reset need `PersonSession`.
- With the rollout off for the caller, every route answers 404.

## Related

- Rules: `.agents/rules/rust/db.md` · Registry: `crates/agent_permission_registry`
