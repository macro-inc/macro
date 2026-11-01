# anthropic

## What it is

Part of AI: the SDK client for the Anthropic Messages API that the rest of
the product's AI surfaces (via `agent`) build requests against, plus an
OpenAI-compatible request/response mapping layer and Anthropic's own
server-side tools (web search, web fetch, bash/text-editor code
execution).

## Start here

- `src/client.rs` + `src/client/chat.rs`: the Anthropic Messages API client and streaming.
- `src/openai/mod.rs`: request/response mapping to the OpenAI `v1/chat/completions` shape
  (feature `openai`) — the standard the `ai` crate builds requests against.
- `src/toolset.rs` + `src/toolset/*.rs`: server-side tool implementations (feature `toolset`).
- `src/types/mod.rs`: wire types for the Messages API.

## Scope

- Owns: the Anthropic API client, its OpenAI-shaped adapter, and Anthropic's
  built-in tools (web search/fetch, code execution).
- Not here: model selection, pricing, usage/billing policy, or the provider-agnostic
  chat abstraction → `crates/agent`, `crates/ai_billing`, `crates/ai_usage`.

## Boundaries

- Depends on: `macro_env_var`, optionally `async-openai` (`openai` feature),
  `ai_billing`/`ai_toolset`/`ai_usage` (`toolset` feature).
- Used by: `crates/ai_tools`.

## Recipes

- Add/change a server tool: `src/toolset/<tool>.rs` → register in `src/toolset.rs`.
- Map a new Anthropic response field into the OpenAI shape: `src/types/mod.rs` →
  `src/openai/stream_response.rs` / `src/openai/stream_extension.rs`.

## Checks

- `cargo test -p anthropic` (`SQLX_OFFLINE` unset).

## Gotchas

- `WebSearch` must tolerate a `pause_turn` stop reason and keep accumulating results
  across turns rather than returning only the last turn's hits (#7421).

## Related

- Rules: `.agents/rules/rust/architecture.md`
