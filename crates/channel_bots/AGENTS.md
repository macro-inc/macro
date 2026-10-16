# channel_bots

## What it is

Part of Chat and Documents: built-in agents for document comments and
channel messages. Reads committed posts from the common message boundary,
decides whether to trigger, authorizes, and delivers a reply.

## Start here

- `src/domain/trigger_detector.rs`: decides whether an incoming message should
  trigger a bot response (mentions, quote-replies, implicit triggers).
- `src/domain/service.rs` + `src/domain/models.rs`: trigger policy and bot turn model.
- `src/outbound/fast_model_trigger_classifier.rs`: Haiku-based implicit-trigger
  classifier used when there's no explicit mention.
- `src/outbound/agent_loop_responder.rs`: drives the agent loop to produce a reply.
- `src/outbound/lexical_comment_marks.rs`: comment-mark delivery for document bots.
- `src/inbound/bot_trigger_router.rs`: wires channel/document message events in.

## Scope

- Owns: deciding when a built-in agent responds to a channel message or document
  comment, and delivering that response back through the same message boundary.
- Not here: bot CRUD/ownership → `crates/bots`; the message store itself →
  `crates/channels`, `crates/messages`.

## Boundaries

- Depends on: `bots`, `channels`, `calendar_events` (time zones), `lexical_client`,
  `messages`, `prompt`, `ai_tools`/`ai_toolset`, `ai_usage`/`ai_billing`.
- Used by: `services/document_storage_service`, its composition root.

## Recipes

- Change what triggers a bot reply: `src/domain/trigger_detector.rs` →
  `src/outbound/fast_model_trigger_classifier.rs` (implicit triggers only).
- Change how a reply is delivered: `src/outbound/agent_loop_responder.rs` →
  `src/outbound/conversation.rs` → `src/outbound/lexical_comment_marks.rs`
  (document comments only).

## Checks

- `cargo test -p channel_bots` (`SQLX_OFFLINE` unset).

## Gotchas

- Implicit (non-mention) triggers go through the fast-model classifier, not the
  main agent model — keep that path cheap; it runs on every message.

## Related

- Rules: `.agents/rules/rust/architecture.md`
