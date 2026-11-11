# Agent code mode

## Scope

Execution credentials carry the authenticated session bot for SDK message
attribution while using the explicitly selected `acting_as` account's API
permissions. Credential issuance resolves and approves that selection before
minting. ExecuteCode requires the originating prompt’s `turn_id`; admission and
credential approval must reject a replacement turn before adopting its account.
Saved execution retries must match both actor selection and original
turn, so a later requester cannot inherit an earlier execution result.

Owns session-authorized code executions, user-scoped executions for the public
MCP, SDK documentation selection, saved execution records, and durable review
stacks. Process isolation belongs to
`crates/code_execution`; session presentation belongs to `crates/agent_session`.

## Start here

- `SKILL.md`: the agent-facing JavaScript contract and examples.
- `src/domain/service.rs`: execution admission, identity and persistence; tool
  receipts include observed SDK activity for inline conversation snapshots.
- `src/domain/user.rs`: `UserCodeMode`, runs as an authenticated user with no
  session, journal or reviews; shares outcome validation with the session path.
- `src/domain/reviews.rs`: review revisions, claims and outcomes.
  `src/domain/reviews/drafts.rs` holds the typed drafts and results: items
  keyed by kind, reusing `SendEmail`, `CreateCalendarEvent` and their
  responses, and the import plan selection. Decoding is the only validation
  (`decode`, location-only errors); value constraints are nutype newtypes.
  Submit refuses incomplete drafts (no recipients, no title, ends before it
  starts) before claiming the batch.
  `decide_for_session` (the `DecideReview` tool, `inbound/reviews.rs`) is the
  agent deciding on the account holder's word in chat: a turn they prompted,
  never a System turn (per `ReviewSession::prompter`), and a Submit only once
  the action is `approvable`.
  An import review only starts its write: its `review.decided` is quiet, and
  its `review.settled` comes from the import when the write ends; only an
  import that could not start settles here.
- `src/domain/reviews/views.rs`: a view is a review with nothing saved.
  `POST /agent-sessions/{id}/views` (`execution.views.present`) shares the
  review's authorization, decodes the view with `dynamic_ui::decode_view`,
  and streams it as a completed `PresentView` call (`view_<id>`) through
  `ReviewActions::present_view`. There is no `PresentView` tool: ExecuteCode's
  description carries the view schema and when to present one.
- `src/domain/connected_apps.rs`: a running execution's connected apps
  (`macro.connectedApps`). `GET|POST /agent-sessions/{id}/code-executions/{execution}/connected-apps…`
  admits only a running execution of the session's current turn, called by
  the account that execution was approved to act as; the harness adapter
  (`agent_harness_service/src/code_mode/connected_apps.rs`) lists the apps the
  session's agent was given (`EgressProvisioner::advertised_all`) and calls
  them through `agent_egress`'s `SessionMcpExchange`, so credentials never
  reach the sandbox. In a turn someone other than the owner prompted, each
  call spending the owner's access is held for the owner's approval
  (`OwnerApprovals::hold_in_process`), like a direct MCP call. `discover`
  and `servers` serve `DiscoverConnectors` and `ConnectMcpServer` through
  the native tool gate, so both tools are in `covered_by_code_sdk`.
- `src/domain/ui_commands.rs`: a running execution's `macro.ui.open`.
  `POST /agent-sessions/{id}/ui-commands` admits the same way connected apps
  do, then sends only for a turn a person prompted from an app tab
  (`TurnPrompter.client`); system turns, routines, triggers and channel
  mentions answer `no_client`. The path must match `navigable_routes.json`,
  generated from the web route table by
  `apps/web/src/features/agent-navigation/core/navigable-routes.test.tsx`
  (`UPDATE_AGENT_ROUTE_TABLE=1` rewrites it; never edit it by hand). The
  table leaves out debug views, which only some builds register; their paths
  fall to the closed `:type/:id` branch. A sent path keeps only the pane's own
  `s0.` search: unprefixed hand-off keys such as `whatsappPairing` are
  dropped, so a command never starts what a link from outside the app does.
  Budgets (5 commands and 3 panes a turn, 30 a person a minute) live in Redis; the
  harness adapters (`agent_harness_service/src/code_mode/ui_commands.rs`) send a
  `ui_command` frame to `user/{prompter}` through the connection gateway behind
  the `enable-agent-navigation` flag. No acknowledgement yet: `sent` is the
  gateway receipt.
- `src/domain/documentation.rs`: the build-time SDK catalog (per entity a
  `@routing` description, an `@agent` guide and an index; a reference per
  symbol). Jev ranks entities on their descriptions, in parallel calls of 32
  (`cognition::domain::decide_in_batches`; a late or failed call loses only
  its own entities), for the per-turn prompt (≥ 0.5, top four, 48 KiB) or a
  `DescribeCodeTools` `task` (every relevant entity, 32 KiB); `ReadCodeDocs`
  reads symbol references (32 KiB). `Guidance::Selected` (owners with
  `auto-skills`) loads each entity's guide with its index; otherwise prompts
  carry `inline_guides`. `mcp_guides` and `entity_guide` serve hosts that
  carry areas whole. All of it is generated from the SDK; edit the TSDoc.
- `src/inbound/toolset.rs`: `toolset()` for sessions, `user_toolset()` for the
  public MCP. Tool texts are composed: host-specific parts in `toolset/session/`
  and `toolset/user/`, guidance both share in `toolset/shared/`. Edit shared
  guidance once, there.

## Boundaries

Inbound adapters authenticate and delegate to domain services. Outbound adapters
implement persistence; the harness composition root wires native actions and
session presentation. Never replay an uncertain submitted action.

## Tool contracts

- `ContentSearch`, `NameSearch`, `ListEntities` and `ReadChat` are covered by the SDK's `search`, `workspace` and `chats` entities (`macro.search`, `macro.workspace`, `macro.chats`); the `search` entity carries the search guide. Keep their filters in step.

Reviews write `review.decided` and `review.settled` through the injected
transaction-aware notification writer in the same revision-checked transaction.
After every successful save, `ReviewActions::announce_update` logs a
`_macro/review_updated` frame (review id and revision, no draft content) in the
session, best effort, so open session views refetch instead of polling.
Reviews persist the immutable acting account. Only that account may edit or
submit.
ACP presentation uses the session owner's transcript capability, independently
of the account that later sends the email or creates the event. Cards require
direct user authentication; `DecideReview` requires a real turn prompted by the
review's acting account, and its Submit waits for `ReviewActions::approvable`
(default: always), the hook a kind uses to refuse until it is ready. `GetReview`
reads final
drafts and outcomes. Legacy notificationId/notificationAttemptAt fields are no
longer delivery state.

## Checks

- `cargo test -p agent_code_mode --lib` from the repository root, with live local
  database configuration and `SQLX_OFFLINE` unset.
- The review toolset test builds every review tool through shared provider schema
  validation.
- The SDK catalog and operation labels come from `crates/code_mode_assets`,
  generated from the public SDK at build time; change the SDK or
  `packages/code-mode-sdk`, never a generated file.

Import reviews contain exactly one draft, with source `notion`, `linear`, or
`jira`. Source selection stays on that draft through presentation and approval.

The web and SDK review types are generated from these Rust types with specta
(`src/bin/export_review_types.rs`, `just gen-agent-review-types` in `apps/web`).
Regenerate after changing a review type or a type a draft or result reuses; CI
fails on stale output.

- Create fresh invocation attribution in the credential issuer; managed MCP session provenance comes only from verified request context.
