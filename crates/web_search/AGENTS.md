# web_search

## What it is

Part of AI tools: web search and page fetch for every agent and the SDK. One
`SearchProvider` port with a Tavily adapter backs the `WebSearch`/`WebFetch`
agent tools (any model, any host) and cognition's `POST /web/search` and
`POST /web/fetch`, which `macro.web.search()`/`macro.web.fetch()` call.

## Start here

- `src/domain/service.rs`: `WebSearchService` — validation, AI admission
  (`AiFeature::WebSearch`), the provider call, and metering the vendor's
  credits to the user (`UsageAmount::ProviderCredits`, pricing id `tavily`).
- `src/domain/models.rs`: the request/response DTOs, shared by the HTTP routes
  and the tools (their schemars titles are the tool names).
- `src/outbound/tavily.rs`: typed reqwest client for `/search` and `/extract`.
- `src/inbound/axum_router.rs`: routes, `ActingUser` auth, per-user hourly limit.
- `src/inbound/toolset.rs`: the agent tools; `ai_tools` builds their context.

## Scope

- Owns: web search/fetch request policy, the vendor adapter, routes and tools.
- Not here: pricing rows and quota counting → `crates/ai_usage`, `crates/ai_billing`.

## Recipes

- Swap or add a vendor: implement `SearchProvider` in `src/outbound/<vendor>.rs`
  → seed its `ai_pricing` row (a migration) → construct it in
  `ai_tools::build_web_search_provider_from_env`.

## Checks

- `cargo test -p web_search --features axum` (no network: Tavily is mocked with
  the fixtures in `src/outbound/tavily/fixtures/`).

## Gotchas

- `TAVILY_API_KEY` is optional at startup so a missing secret cannot stop a
  host; every call then fails with `web_search_not_configured`. Never log it.
- Only the HTTP routes are rate limited; tool calls are bounded by agent turns.
- Usage is recorded only when Tavily reports `usage.credits`; the service warns otherwise.
- Code mode hides the tools (`agent_code_mode::domain::covered_by_code_sdk`);
  agents there use the SDK.

## Related

- Rules: `.agents/rules/rust/architecture.md`
