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
- `src/executable.rs`: `PATH` lookup; every spawn of a bare command name goes
  through `launchable`, which finds Windows `.cmd` shims (`npm`, `npx`).
- `install/`: `install.sh` and `install.ps1`, the one-line installers the docs
  serve from `main`. They download `macrod-<os>-<arch>` from the latest release.
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

Channel/document trigger prompts retain their source message ID through
`TriggerWork` and send it as `ControlRequest.action_id`. Preserve this correlation
for initial mentions, existing-session follow-ups, and conflicted-create retries;
external chat replies depend on it. Direct session controls still mint IDs.

## Checks

- `cargo test -p coding_agent_worker` (`SQLX_OFFLINE` unset).
- `just run` (from this directory) to run the daemon against `macrod.toml` at
  the repo root.
- `OPENSSL_NO_VENDOR=0 just build-static` to build and smoke-test the release `macrod` the way
  the tag workflow does (needs the Nix devshell: cargo-zigbuild, zig, cmake).
  The override enables bundled OpenSSL for the musl target in the devshell.
- Windows is built natively on a Namespace Windows runner by
  `build_agent_daemon_on_tag` (MSVC, static CRT). Run that workflow with
  `workflow_dispatch` on your branch to check a Windows-affecting change.
- `cargo tree -p coding_agent_worker -i rdkafka-sys --target x86_64-unknown-linux-musl`
  must find nothing: librdkafka breaks the static and Windows builds.

## Gotchas

- `src/herdr.rs` and its submodule are Unix-only (`#[cfg(unix)]`); don't add
  Windows-breaking code there without a cfg gate.
- The ACP child is killed with its whole tree: a process group on Unix, a Job
  Object on Windows (`src/outbound/acp_process/job.rs`).
- macrod never pulls into the operator's working branch — new herdr worktrees
  start from a fresh fetch of `origin/main` (see README.md).
- Switching native agents clears the previous agent's model/extra-args but
  keeps storage and focus preferences (README.md, "Setup").

## Related

- `README.md` in this directory is the native herdr behavior contract —
  update it alongside `src/herdr/` changes.
- MCP server selection is supplied by `agent_harness` when the session binds;
  native launch forwards that list, with credentials refreshed on launch/resume.
