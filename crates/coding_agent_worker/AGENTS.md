# coding_agent_worker

## What it is

Part of agent sessions: `macrod`, the agent harness daemon operators run on
their own machine — serves a registered harness's agent sessions, bridges
the local ACP process (Claude Code, Codex, ...), and drives native
[herdr](https://herdr.dev) sessions, all inside one terminal control panel.

## Start here

- `src/main.rs`: module list and the composition root's CLI entrypoint.
- `src/config.rs`: `macrod.toml` — the daemon's one input, machine-local only
  (see `config.example.toml`, `default.macrod.toml`). The TUI and
  `macrod service` share `~/.macrod/macrod.toml` (`--config` overrides it),
  locked by `<config>.lock` while running. Name, ownership, and permission
  bypass live only on the web (Settings → Machines); a file that still
  has `[identity]` or a `scope` in `[credentials]` fails to load with an error
  naming that page; desktop setup (`macrod service --agent/--workspace`)
  drops those and the retired `[server]` table instead (`drop_retired_settings`). The event stream reads the owner from `GET /harnesses/me`
  on each connect. `[macro]` is a dev override that defaults to production.
- `src/daemon.rs` + `src/runtime.rs`: the serving core — persistent harness
  service connection, ACP process bridge, start/stop/restart on re-pair.
- Pass `macrod service --ignore-stdin-eof` under system service managers;
  embedded services keep the default shutdown when their parent's stdin closes.
- `src/self_knowledge.rs`: the `<macrod-runtime>` section the bridge
  (`src/harness.rs`) prefixes to each new session's first prompt — macrod
  version, workspace, forwarded MCP servers, permission bypass, listing only
  what the session has. General Macro guidance stays in the `SelfKnowledge` tool.
- `src/enroll.rs`: `macrod enroll --from incus|file:<path> --config <path>`,
  run as root by the box image's `macrod-enroll.service` on a Macro computer.
  Reads the `hosted_runtimes` `Enrollment` (Incus guest API
  `/dev/incus/sock`, key `user.macro.enrollment`, or a file), writes
  `macrod.toml` with the enrollment's typed deployment (API, storage, app and
  computer-reachable egress URLs; macrod.toml stays the one URL source at runtime).
  It claims the pre-approved pairing, chowns the config to its directory's owner,
  then writes `/var/lib/macrod/enrolled`. A stored credential skips the claim, so
  retries are safe; a failed claim retries every 250 ms for up to five
  minutes. `--root` (hidden) prefixes system paths for tests. Enrollment
  writes only the config, the credential and its markers: no systemd units,
  users or anything under `/etc`, which is read-only on the NixOS guest (the
  image declares every unit). The marker (`<computer id>\n<generation>`)
  lives on the data disk, so a new root disk (reboot onto a new image) finds it and macrod reconnects
  with its stored credential. A newer generation (a guest recreated on the
  old disk) or a marker-less disk enrolls again; the credential records the
  pairing it was claimed from (`credentials.pairing_id`), so only a new
  pairing is claimed, and nothing else on the disk is touched. No enrollment
  in the source (removed after macrod connects) with a marker means enrolled.
- `src/computer.rs`: the one Macro-computer hook in sessions. On an enrolled Macro
  computer only (the marker exists), each Claude Code session's env: `ANTHROPIC_BASE_URL` (the
  session's `macro_internal` MCP URL with `/mcp/internal` → `/anthropic`),
  `ANTHROPIC_AUTH_TOKEN` (its bearer) and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` go to `session/new|load|resume`
  as `_meta.claudeCode.options.env`, always. It calls nothing in Claude and
  reads no Claude files: harnessd (`crates/harnessd`) owns Claude sign-in, and the
  image's `claude` wrapper swaps the gateway env for the computer's own
  credential when harnessd holds one. ACP trace logs contain only direction
  and byte counts.
- `src/trigger.rs` + `src/dispatch.rs`: agent-trigger broker events → session
  create/dial/prompt against the live harness service.
- `src/daemon.rs` `watch_presence`: each minute a connection has held, asks
  `GET /harnesses/me` with `RUNTIME_CONNECTED_HEADER`. A service that reads the
  harness offline logs `harness_presence_disagreement`, macrod warns, and the TUI
  header says "machine connected, service reports offline" instead of "paired,
  machine not dialed in".
- `src/tui.rs` (`src/tui/`): the control panel itself (registration, agents,
  sessions, config form, logs).
- `src/herdr.rs` (`src/herdr/`): native herdr integration — only compiled
  `#[cfg(unix)]`. `src/herdr/cli.rs` picks herdr 0.9 (`herdr`) or herdr-core
  (`hc`) by environment; both stay supported.
- `src/executable.rs`: `PATH` lookup; every spawn of a bare command name goes
  through `launchable`, which finds Windows `.cmd` shims (`npm`, `npx`) and
  never npm's extensionless shell script beside them. The Claude Code adapter
  gets the program behind an npm `claude.cmd` (`npm_shim_target_or_self`):
  the Claude SDK spawns `CLAUDE_CODE_EXECUTABLE` without a shell, and Node
  refuses `.cmd` files there.
- `install/`: `install.sh` and `install.ps1`, the one-line installers the docs
  serve from `main`. `install.sh` adds `~/.local/bin` to the shell's startup
  file once (`--no-modify-path` opts out); `install.ps1` installs the Windows
  launcher layout. Both take `MACROD_UPDATE_SOURCE`.
- `src/update.rs` (`src/update/`): self-update. The TUI polls the latest
  GitHub release hourly (or the `MACROD_UPDATE_SOURCE` mirror: `latest.json`
  plus the archives beside it), verifies and smoke-tests the new binary, and
  once `Daemon::is_idle` (no `session/prompt` outstanding, `src/turns.rs`)
  swaps it in and `execve`s. Spans: `macrod.update.check`,
  `macrod.update.download`, `macrod.update.apply`, `macrod.update.handoff`.
  Off with `[update] auto = false` or `MACROD_NO_UPDATE=1`. Every check,
  download, apply and TUI startup appends a JSON line to
  `~/.macrod/logs/update.log` (`src/update/log.rs`; 0600, rotated at 1 MB to
  `update.log.1`); the Logs tab shows the path. Versions and outcomes only.
- `src/handoff.rs`: the Unix hot handoff. `harness.rs` is macrod's own line
  relay (`outbound/acp_process/running.rs`), so it can stop at a line
  boundary and pass the live agent (pid, pipes, unread bytes, running
  prompts) to the next image through a versioned state file named by
  `MACROD_HANDOFF_FD`. State the new image cannot read kills the agent and
  starts fresh. Bump `FORMAT_VERSION` when `HandoffState` changes.
- `src/update/versions.rs`: the Windows layout. `macrod.exe` on `PATH` is a
  launcher for the newest `versions\<tag>\macrod-core.exe`; updates install
  as a new version for the next launch and the footer says so.
- `e2e/`: end-to-end update and installer tests (`build_releases.sh`,
  `update_e2e.py` (update, prompt-in-gap, output-in-gap, and the negative
  cases), `installer_test.sh`, `windows_test.ps1` for the launcher
  layout, `windows_update_test.ps1` for a running macrod updating itself,
  `windows_claude_code_test.ps1` for npm-installed Claude Code served over
  ACP), run
  by the `test_macrod_update` workflow on Linux, macOS and Windows; and
  `memory_soak.py`, the panel's resident-memory check, run by hand (Checks).
- `README.md`: native Herdr session behavior (repositories, reconnect, model
  switching, MCP) — read before changing anything under `src/herdr/`.

## Scope

- Owns: the `macrod` binary end to end — config, pairing, the harness bridge,
  trigger dispatch, native herdr session control, and the TUI.
- Not here: the trigger event vocabulary (`agent_trigger`), the fold/transcript
  logic for a given provider (`claude_fold`, `codex_fold`), or the harness
  service itself (`services/agent_harness_service`).

## Recipes

- Add a config field (machine-local only: commands, paths, local launch
  defaults; runtime behaviour a Macro user controls belongs on the web harness
  row, and never put a launch command on the web): `src/config.rs` →
  `config.example.toml` → `default.macrod.toml` → the TUI config form
  (`src/tui/config_form/`).
- Handle a new trigger kind: `src/trigger.rs` → `src/dispatch.rs` → its tests.
- Add/change a native herdr control (command, model picker): `src/herdr/controls/`
  → `README.md` (native controls section) → `src/herdr/acp_agent/`.

Channel/document trigger prompts retain their source message ID through
`TriggerWork` and send it as `ControlRequest.action_id`. Preserve this correlation
for initial mentions, existing-session follow-ups, and conflicted-create retries;
external chat replies depend on it. Direct session controls still mint IDs.

## Checks

- `cargo test -p coding_agent_worker` (`SQLX_OFFLINE` unset).
- `just run` (from this directory) to run the daemon with
  `--config <repo root>/macrod.toml`, keeping dev off `~/.macrod/macrod.toml`.
- Self-update end to end (Linux/macOS): `e2e/build_releases.sh /tmp/rel
  v2000.1.1.1 v2000.1.1.2`, then `python3 e2e/update_e2e.py --releases /tmp/rel
  --v1 v2000.1.1.1 --v2 v2000.1.1.2`, and `e2e/installer_test.sh /tmp/rel
  v2000.1.1.1` with zsh and fish on `PATH`. `MACROD_UPDATE_CHECK_SECONDS`
  shortens the check interval.
- `OPENSSL_NO_VENDOR=0 just build-static` to build and smoke-test the release `macrod` the way
  the tag workflow does (needs the Nix devshell: cargo-zigbuild, zig, cmake).
  The override enables bundled OpenSSL for the musl target in the devshell.
- Resident memory (Linux, after changing the panel, the relay, or the allocator):
  `python3 e2e/memory_soak.py --binary <repo root>/target/x86_64-unknown-linux-musl/release/macrod`
  runs the panel against a fake storage service for 10 minutes and fails if it
  is still growing after warm-up. Use the `just build-static` binary; a glibc
  build allocates differently.
- Windows is built natively on a Namespace Windows runner by
  `build_agent_daemon_on_tag` (MSVC, static CRT). Run that workflow with
  `workflow_dispatch` on your branch to check a Windows-affecting change.
- `cargo tree -p coding_agent_worker -i rdkafka-sys --target x86_64-unknown-linux-musl`
  must find nothing: librdkafka breaks the static and Windows builds.

## Gotchas

- Paired credentials remain scope-free. Resolve webhook scope from current
  `shared_team_ids`, never a team owner variant; every harness has a human owner.

- `src/herdr.rs` and its submodule are Unix-only (`#[cfg(unix)]`); don't add
  Windows-breaking code there without a cfg gate.
- Set the PTY master's close-on-exec flag with `fcntl` on macOS; its
  `posix_openpt` does not accept `O_CLOEXEC`.
- The ACP child is killed with its whole tree: a process group on Unix, a Job
  Object on Windows (`src/outbound/acp_process/job.rs`).
- The musl release allocates with mimalloc (`src/main.rs`). zig's libc
  `malloc`, which cargo-zigbuild links otherwise, keeps memory freed on another
  thread, and tokio frees on any worker: resident memory grew by gigabytes over
  days with a flat live heap. Other targets use the system allocator.
- The panel keeps one HTTP client for its lifetime (`tui/api.rs`
  `dashboard_client`). It uses the system resolver (`no_hickory_dns`), because
  hickory reads DNS servers once at build and would miss a VPN or network change.
- Every herdr call goes through the `HerdrCli` facade; add a capability to both
  `cli/legacy.rs` and `cli/hc.rs`. herdr-core has no agent registry or
  worktrees, and status comes only from OSC 7501 (README.md, "Herdr versions").
- macrod never pulls into the operator's working branch — new herdr worktrees
  start from a fresh fetch of `origin/main` (see README.md).
- Only release builds update themselves: the tag workflow compiles the tag in
  as `MACROD_RELEASE_TAG`, and a build without a `vYYYY.MM.DD.N` tag never
  polls. `macrod service` (the desktop app's bundled copy) never updates; the
  desktop app updates it.
- The update still waits for idle although the agent survives it: the
  harness service ends a session's turn when its runtime connection closes,
  so a turn in flight would be cut off in Macro. After a handoff the service
  re-runs `initialize` and `session/resume` (or `load`) on the live agent.
- A `macrod herdr-acp` harness is a child process, so it is handed off like
  any agent and keeps running the old binary until it restarts.
- Switching native agents clears the previous agent's model/extra-args but
  keeps storage and focus preferences (README.md, "Setup").

## Related

- `README.md` in this directory is the native herdr behavior contract —
  update it alongside `src/herdr/` changes.
- MCP server selection is supplied by `agent_harness` when the session binds;
  native launch forwards that list, with credentials refreshed on launch/resume.

Macro computers replace the managed `/workspace` placeholder with their configured
workspace on session start. The enrollment deployment's egress URL is
stored as `[macro].egress_url`; computer sessions route first-party MCP and
Anthropic requests through it without changing custom external MCP addresses.

Service/enrollment telemetry opts in with `OTEL_EXPORTER_OTLP_ENDPOINT`
(gRPC). Only enrollment spans (`run_enroll`, `macrod.enroll.claim`) export,
with the marker's computer UUID as a resource attribute. Enrollment joins the
setup trace from `Enrollment.traceparent`; its claim sends the setup
`traceparent`. stdout remains the daemon protocol.
