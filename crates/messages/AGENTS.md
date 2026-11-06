# messages

## What it is

The messaging/discussions feature: anchored discussions on channels and
documents. This domain crate owns the models, authorization, and the
HTTP/Postgres/delivery adapters, feature-gated so callers pull in only what
they need.

## Start here

- `src/domain/models.rs`: shared message/thread models.
- `src/domain/service.rs` + `src/domain/ports.rs`: use-case orchestration and
  the repository/delivery ports (feature `ports`).
- `src/domain/api.rs`: `MessageServiceApi`, the boundary HTTP/agents/channel
  adapters call through.
- `src/inbound/axum_router.rs`: the HTTP surface (feature `inbound`).
- `src/inbound/toolset.rs`: the AI tools for any entity's Discussion
  (`ReadDiscussion`, `Comment`, `EditComment`, `DeleteComment`,
  `ResolveComment`; feature `ai_tools`), addressed by parent kind and id or by
  a thread or comment id alone. `DiscussionParentType::from_parent` is
  exhaustive: a new `MessageParent` variant decides there whether the tools
  address it.
- `src/domain/discussions.rs`: a parent's live threads with all replies, the
  read both `ReadDiscussion` and the document comment reader share.
- `src/domain/service/guest_chat.rs` + `src/inbound/guest_chat.rs`: live guest
  call discussions; the call domain verifies RTC credentials and membership.
- `src/outbound/pg_message_repo.rs` + `pg_discussion_context.rs`: Postgres
  adapters (feature `outbound`).
- `src/outbound/connection_gateway.rs`, `notification_sender.rs`, `broker.rs`:
  realtime/notification delivery adapters (features `outbound`/`broker`).

## Scope

- Owns: message and discussion domain logic, mentions, notification policy
  for messages, and their delivery/storage adapters.
- Not here: channel membership and chat domain logic → `channels`, `chat`;
  who gets notified in general → `model_notifications`.

## Boundaries

- Depends on (by feature): `entity_access` (ports/inbound), `model` (annotations),
  `properties`/`models_properties`/`model_notifications`/`notification`
  (delivery), `initiative` (outbound), `macro_event_broker`/`macro_event_topics`
  (broker).
- Used by: `agent_harness`, `agent_session`, `agent_trigger`, `ai_tools`, `bots`,
  `channel_bots`, `channels`, `coding_agent_worker`, `crm`, `documents`,
  `lexical_client`, `lexical_mention_extractor`, `macro_db_client`,
  `soup_realtime`, `webhook`.

## Recipes

- Add a message use case: `src/domain/ports.rs` (port) → `src/domain/service.rs`
  → `src/domain/api.rs` → `src/inbound/axum_router.rs`.
- Add a delivery channel: `src/domain/delivery.rs` → new adapter under
  `src/outbound/` → feature-gate it in `Cargo.toml`.

## Checks

- `cargo test -p messages --all-features` (`SQLX_OFFLINE` unset).

A finalized bot reply (`NotifyAsPostedMessage` edit by the bot itself) carries
`completed_reply` on its patch event so agent triggers evaluate it like a new
post; streaming updates and ordinary edits never do.

A bot post made for a user through a named client (an MCP client on the public
MCP) uses `MessageAttribution::ActingUserVia`; the client's self-reported name is
stored in `comms_messages.triggered_via` beside `triggered_by`, the product the
OAuth broker verified it as in `triggered_via_kind`, and clients show
the post as that client's ("Claude Code · Agent · from <user>"). It is a display
label, and the kind picks the avatar mark. Over HTTP the label comes only from
the signed `agent_via` / `agent_via_kind` claims of
a code-mode token, never from the request body.

New posts use the message sender receipt to retain signed code-mode agent
attribution. All other operations use the caller receipt so attribution cannot
grant users another agent invocation's edit, deletion, or reaction authority.

## Gotchas

- `MessageKind::CallRoot` messages stand for a channel call. Only `ensure_call_root` creates them, and
  they announce themselves with `MessageChange::CallRootPosted`, which reaches viewers and nothing else.
- Most modules are feature-gated (`ai_tools`, `annotations`, `broker`,
  `delivery`, `inbound`, `outbound`, `ports`, `schema`); a caller enabling the wrong
  combination gets a missing-module compile error, not a runtime one — check
  `Cargo.toml`'s `[features]` table before adding a dependency edge.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `collab-surface-core`
