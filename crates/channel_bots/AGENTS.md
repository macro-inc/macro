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
  `with_agent_loop` configures the runner while preserving mention-bound tools.
  Classic replies use `AgentLoop` directly, without `RigTurnEngine` or its
  automatic owner-memory fetch; native memory tools are hidden. The composed
  responder regression checks that a reply does not enroll memory refresh.
- `src/outbound/code_mode.rs`: every reply runs code mode (`ChannelBotTools`).
  The direct tools are `ai_tools::tools_for_channel_bot_code_mode` (SDK-covered
  and Anthropic sandbox tools dropped) plus `agent_code_mode`'s user `ExecuteCode`,
  `DescribeCodeTools` and `ReadCodeDocs`. Programs run on the agent harness
  (`POST /internal/code-mode/user-executions`, internal key) as the mentioning
  user attributed to Macro AI, the same identity as the direct tools, with a
  signed allowlisted ChannelMention scope and the original mention claim.
  Programs make only explicitly listed workspace reads; they cannot write,
  query memory, mint tokens, delegate work or call connected apps. Their
  egress always uses the forwarder, even with its rollout flag off, and has
  no unfurl upstream; DSS delivers the final reply.
  A call to
  a tool the code-mode reply was not offered is refused, never dispatched.
- `src/outbound/lexical_comment_marks.rs`: comment-mark delivery for document bots.
- `src/inbound/bot_trigger_router.rs`: wires channel/document message events in.

## Scope

- Owns: deciding when a built-in agent responds to a channel message or document
  comment, and delivering that response back through the same message boundary.
- Not here: bot CRUD/ownership → `crates/bots`; the message store itself →
  `crates/channels`, `crates/messages`.

## Boundaries

- Depends on: `bots`, `channels`, `calendar_events` (time zones), `lexical_client`,
  `messages`, `prompt`, `ai_tools`/`ai_toolset`, `ai_usage`/`ai_billing`,
  `agent_code_mode` (the `MentionCodeMode` port and user code tools),
  `code_execution`, `cognition`.
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
- Bot-authored messages cannot explicitly or implicitly start classic Macro
  programs for their owner. Other bot targets retain the agent hop limit
  (`messages::domain::agent_hops::MAX_AGENT_HOPS`); unattributed posts trigger
  nothing. Human mentions and inference remain available.
- A post a user made through a client (an MCP client) is sent as Macro AI's
  bot with `triggered_via` set. It is the client's, not Macro AI's: a thread
  whose only Macro AI messages are such posts is not a Macro AI thread, so a
  reply to one infers nothing; only a human
  explicit `@macro` mention invokes classic Macro.

## Related

- Rules: `.agents/rules/rust/architecture.md`
