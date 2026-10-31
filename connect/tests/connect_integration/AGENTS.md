# Connect integration runner

## What it is

An opt-in binary that checks a running Connect service through the public Rust client and HTTP endpoints. Workspace tests do not launch it.

## Start here

- `src/main.rs`: scenarios and PASS/FAIL reporting.
- `../../tooling/integration.sh`: local Compose and dev entry points.

## Scope

- Owns: live-service integration scenarios.
- Not here: API behavior or registry definitions.

## Checks

- `connect/tooling/integration.sh local`
- `cargo clippy -p connect_integration --all-features --all-targets -- -D warnings`
