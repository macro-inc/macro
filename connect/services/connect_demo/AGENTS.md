# Connect demo

## What it is

A standalone customer app for exercising Connect's catalog, OAuth flow, MCP gateway, and customer dashboard.

## Start here

- `src/main.rs`: browser routes, cookie identity, rendering, and startup.
- `src/mcp.rs`: MCP initialization, session handling, JSON/SSE parsing, and tool calls.
- `src/app.js`: loads tool forms and results into the catalog page.
- `src/test.rs` and `src/mcp/test.rs`: fake Connect and held-open SSE tests.

## Scope

- Owns: demo browser experience and its opaque browser identity.
- Not here: OAuth grants or vendor credentials → `connect_api`.

## Boundaries

- Connect access goes through `connect_client`; the demo never exports vendor tokens.
- The configured public URL ends in `/demo` and is the OAuth redirect target base.
- `/demo/dashboard` uses the public client to show customer summary counts,
  catalog app totals, and up to 500 complete users per page.
  App and status filters are server-rendered query parameters; `cursor` moves
  to the next user page.

## Checks

- `cargo nextest run --all-features -p connect_demo`
- `cargo clippy -p connect_demo --all-features --all-targets -- -D warnings`
- `cargo x deps --check` after `just hakari` when dependencies change.
