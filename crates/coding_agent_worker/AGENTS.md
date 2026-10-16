# coding_agent_worker

## What it is

Part of agent sessions: `macrod`, the agent harness daemon operators run on
their own machine — serves a registered harness's agent sessions, bridges
the local ACP process (Claude Code, Codex, ...), and drives native
[herdr](https://herdr.dev) sessions, all inside one terminal control panel.

## Start here

- `src/main.rs`: module list and the composition root's CLI entrypoint.
- `src/config.rs`: `macrod.toml` — the daemon's one input (see
  `config.example.toml`, `default.macrod.toml`).
- `src/daemon.rs` + `src/runtime.rs`: the serving core — persistent harness
  service connection, ACP process bridge, start/stop/restart on re-pair.
- `src/trigger.rs` + `src/dispatch.rs`: agent-trigger broker events → session
  create/dial/prompt against the live harness service.
- `src/tui.rs` (`src/tui/`): the control panel itself (registration, agents,
  sessions, config form, logs).
- `src/herdr.rs` (`src/herdr/`): native herdr pane integration — only compiled
  `#[cfg(unix)]`.
- `README.md`: native Herdr session behavior (repositories, reconnect, model
  switching, MCP) — read before changing anything under `src/herdr/`.

## Scope

- Owns: the `macrod` binary end to end — config, pairing, the harness bridge,
  trigger dispatch, native herdr session control, and the TUI.
- Not here: the trigger event vocabulary (`agent_trigger`), the fold/transcript
  logic for a given provider (`claude_fold`, `codex_fold`), or the harness
  service itself (`services/agent_harness_service`).

## Recipes

- Add a config field: `src/config.rs` → `config.example.toml` →
  `default.macrod.toml` → the TUI config form (`src/tui/config_form/`).
- Handle a new trigger kind: `src/trigger.rs` → `src/dispatch.rs` → its tests.
- Add/change a native herdr control (command, model picker): `src/herdr/controls/`
  → `README.md` (native controls section) → `src/herdr/acp_agent/`.

## Checks

- `cargo test -p coding_agent_worker` (`SQLX_OFFLINE` unset).
- `just run` (from this directory) to run the daemon against `macrod.toml` at
  the repo root.
- `just build-static` to build and smoke-test the release `macrod` the way
  the tag workflow does (needs the Nix devshell: cargo-zigbuild, zig, cmake).

## Gotchas

- `src/herdr.rs` and its submodule are Unix-only (`#[cfg(unix)]`); don't add
  Windows-breaking code there without a cfg gate.
- macrod never pulls into the operator's working branch — new herdr worktrees
  start from a fresh fetch of `origin/main` (see README.md).
- Switching native agents clears the previous agent's model/extra-args but
  keeps storage and focus preferences (README.md, "Setup").

## Related

- `README.md` in this directory is the native herdr behavior contract —
  update it alongside `src/herdr/` changes.
