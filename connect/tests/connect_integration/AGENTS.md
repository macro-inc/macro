# Connect integration runner

## What it is

An opt-in binary that checks a running Connect service through the public Rust client and HTTP endpoints. Workspace tests do not launch it.

## Start here

- `src/main.rs`: scenarios and PASS/FAIL reporting.
- `connections_listing` checks summary, connection listing, and user listing
  parameters for a fresh user.
- `../../tooling/integration.sh`: local Compose and dev entry points.
- `local-acceptance` checks DCR app authorize pages through local Connect;
  `dev` checks every live app against the public dev URL.
- Set `CONNECT_IT_PROJECT` to use an isolated Compose database when an existing
  local project's migrations do not match this worktree.

## Scope

- Owns: live-service integration scenarios.
- Not here: API behavior or registry definitions.

## Checks

- `connect/tooling/integration.sh local`
- `cargo clippy -p connect_integration --all-features --all-targets -- -D warnings`
