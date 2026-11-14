# agent_monitor_tui

## What it is

The agent monitor's terminal viewer (`macrod monitor`): it subscribes to the
collector in `crates/agent_monitor` and draws the board, panes and pages with
ratatui. Not written yet; the crate holds its place in the workspace.

## Scope

- Owns: view state, the key machine, panes, pages, drill-in.
- Not here: the model, store and gRPC client → `crates/agent_monitor`.

## Checks

- `cargo nextest run --all-features -p agent_monitor_tui`
