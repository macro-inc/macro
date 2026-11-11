# macro_service_urls

## What it is

Shared infrastructure: re-exports every typed Macro service URL from its own
crate in `crates/platform/service_urls/` and keeps the `ServiceUrls`
collection. New code depends on the one URL crate it needs instead, so a URL
change rebuilds only that URL's users.

## Start here

- `src/lib.rs`: the re-exports and `ServiceUrls`.
- `src/test.rs`: default and override tests for every URL and for the
  `service_url!` macro, using `service_url`'s `testing` mock.

## Recipes

- Add a service URL: see `crates/platform/service_urls/AGENTS.md`; then
  re-export it here, add its `ServiceUrls` field and a parse test.

## Checks

- `cargo test -p macro_service_urls` (`SQLX_OFFLINE` unset).

## Gotchas

- The override env var name is derived from the struct name
  (`CalendarServiceUrl` → `OVERRIDE_CALENDAR_SERVICE_URL`); renaming a struct
  silently changes what override callers must set.
- `local` defaults are host ports, not Docker-network addresses; a service
  calling another from inside Docker needs an `OVERRIDE_*_URL` entry in
  `local_env.rs`, not a different `local` default.
- Cognition, scheduling, preview control, and public MCP share the agent
  harness process. `McpPublicUrl` and `CognitionPublicUrl` keep the registered
  public OAuth identities; do not substitute the internal API routes when
  building callbacks. `McpChatgptServiceUrl` is the ChatGPT MCP Worker, a
  separate process; the harness's OAuth broker accepts its `/mcp` URL as a
  token resource.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` ·
  Docs: `docs/guides/new-service.md` (§5 Service discovery)
