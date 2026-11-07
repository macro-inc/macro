# connect_client

## What it is

A pinned copy of Macro Connect's public Rust client, `crates/clients/connect_client`
in the private repo macro-inc/macro-connect, at commit `0814a61`. Macro reaches
Connect only through this crate.

## Start here

- `src/lib.rs`: `ConnectClient`: catalog, connect sessions, connections,
  token export, and the MCP gateway address (`mcp_upstream`).
- `src/wire.rs`: the JSON bodies Connect's API serves.

## Scope

- Owns: nothing. The source of truth is macro-inc/macro-connect.
- Not here: how Macro uses Connect → `pipedream_mcp` (`outbound/connect.rs`).

## Gotchas

- Do not edit it here. Change it upstream, then copy `src/` over again and
  update the commit above. The one local difference: trace headers are
  injected with `macro_tower_layers::inject_trace_headers` instead of
  Connect's `connect_platform`.
- It is a copy because Macro's CI and image builds cannot read the private
  repo. Replace it with a git dependency pinned to a rev once they can.

## Boundaries

- Depends on: `macro_tower_layers` (trace injection).
- Used by: `pipedream_mcp`.

## Checks

- `cargo nextest run -p connect_client`
