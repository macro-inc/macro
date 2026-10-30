# search_service_client

## What it is

Part of the Search feature. HTTP client for `search_service`,
authenticating with the internal API key header instead of a user JWT.

## Start here

- `src/lib.rs`: `SearchServiceClient::new` — sets `INTERNAL_API_KEY_HEADER` on
  every request via `reqwest::Client::builder().default_headers(...)`.
- `src/search_unified.rs` / `src/search_channel_name.rs`: one file per endpoint.

## Scope

- Owns: typed calls into `search_service`'s HTTP API.
- Not here: the search implementation or its OpenSearch index → `search_service`.

## Boundaries

- Depends on: `models_search` (request/response types).
- Used by: `ai_tools`, `memory`, `skills`, `document_cognition_service`, `mcp_service`.

## Recipes

- Add an endpoint: define the route + types in `search_service` (`src/api.rs`,
  `src/openapi.rs`) → new `src/<endpoint>.rs` here using `SearchServiceClient`.

## Checks

- `cargo test -p search_service_client` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Skill: `add-sdk-endpoint`
