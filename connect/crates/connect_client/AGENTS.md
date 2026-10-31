# Connect client

## What it is

The public Rust surface for Macro Connect customers. API changes here are breaking for customers.

## Start here

- `src/lib.rs`: authenticated async client, error mapping, and MCP gateway address.
- `src/wire.rs`: shared request and response types used by the client and `connect_api`.

## Scope

- Owns: customer-facing Rust API and HTTP wire contract.
- Not here: Connect server policy or storage → `connect_api`.

## Boundaries

- Depends on: `connect_platform` for trace injection and third-party crates.
- Used by: Macro and other Connect customers; `connect_api` imports only `wire`.

## Checks

- `cargo nextest run --all-features -p connect_client`
- `cargo clippy -p connect_client --all-features --all-targets -- -D warnings`
- `cargo x deps --check` after `just hakari` when dependencies change.
