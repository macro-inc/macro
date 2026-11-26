# anthropic

## What it is

Part of AI: the SDK client for the Anthropic Messages API that the rest of
the product's AI surfaces (via `agent`) build requests against, plus an
OpenAI-compatible request/response mapping layer. Macro agents offer no
Anthropic server tools: the bash and text-editor code-execution tools were
removed, and only their response wire types remain so saved transcripts
still render. Web search and fetch are vendor-neutral tools in
`crates/web_search`.

## Start here

- `src/client.rs` + `src/client/chat.rs`: the Anthropic Messages API client and streaming.
- `src/openai/mod.rs`: request/response mapping to the OpenAI `v1/chat/completions` shape
  (feature `openai`) — the standard the `ai` crate builds requests against.
- `src/types/mod.rs`: wire types for the Messages API.

## Scope

- Owns: the Anthropic API client, its OpenAI-shaped adapter, and the wire
  types for Anthropic responses, including the code-execution results of
  saved transcripts.
- Not here: web search and fetch → `crates/web_search` (wired as tools in `crates/ai_tools`).
- Not here: model selection, pricing, usage/billing policy, or the provider-agnostic
  chat abstraction → `crates/agent`, `crates/ai_billing`, `crates/ai_usage`.

## Boundaries

- Depends on: `macro_env_var`, optionally `async-openai` (`openai` feature).
- Used by: `crates/ai_tools`.

## Recipes

- Map a new Anthropic response field into the OpenAI shape: `src/types/mod.rs` →
  `src/openai/stream_response.rs` / `src/openai/stream_extension.rs`.

## Checks

- `cargo test -p anthropic` (`SQLX_OFFLINE` unset).

## Gotchas

- The old code-execution tool schemas live in `crates/ai_tools/src/schemas/anthropic_tools.rs`
  as frontend-only phantom tools; they are never offered to a model.

## Related

- Rules: `.agents/rules/rust/architecture.md`
