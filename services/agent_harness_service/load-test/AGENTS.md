# load-test

## What it is

The retained legacy cognition load-test utility. It is a development CLI,
not a deployed service. Its configurable API base now points to the harness's
`/cognition` surface; older WebSocket scenarios predate the current POST stream API.

## Start here

- `src/main.rs`: command entry point.
- `src/config.rs`: test-run parameters and target URL.

## Scope

Owns load-generation code only. Production HTTP APIs and authentication live in
the parent `agent_harness_service` and its domain crates.

## Checks

- `cargo check -p load-test`.
- Do not run load tests against hosted environments without explicit permission.
