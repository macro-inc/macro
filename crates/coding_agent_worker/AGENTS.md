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
  naming that page. The event stream reads the owner from `GET /harnesses/me`
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
  image declares every unit). The marker lives on the data disk, so an image
  update skips enrollment and macrod reconnects with its stored credential.
- `src/capabilities.rs`: on an enrolled Macro computer only (the marker
  exists), reports `HarnessCapabilities` (`screen` = Xvnc on
  `127.0.0.1:5900`, and `claude` = the Claude sign-in, both probed once a
  minute) to `PUT /harnesses/me/capabilities` when they change. Open a fresh connection for each report so recurring polls
  cannot pin a reassigned service IP after backend restarts. The reporter is
  cancellation-aware and tracked by the daemon's `TaskTracker`, including
  across re-pair and shutdown.
- `src/computer.rs` (`src/computer/`): on an enrolled Macro computer only,
  the `computerControl` runtime messages and each Claude Code session's env.
  Credits mode (no token) adds `ANTHROPIC_BASE_URL` (the session's
  `macro_internal` MCP URL with `/mcp/internal` → `/anthropic`),
  `ANTHROPIC_AUTH_TOKEN` (its bearer) and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` to `session/new|load|resume`
  as `_meta.claudeCode.options.env`; once Claude Code is signed in to a
  Claude account those variables are removed and sessions use Claude Code's
  own stored credential, for sessions opened after the switch.
  `claude_sign_in.rs` runs Claude Code's own login in a "Claude sign-in"
  herdr workspace (`herdr_pane.rs` starts the user's headless `herdr server`
  when none runs): it answers the first-run text-style and login-method
  questions or types `/login`, reads the hard-wrapped OAuth URL off the
  screen, types the pasted code, and treats `OAuth error` as typed
  `InvalidCode` (start again for a fresh URL). Screen recognition is pure
  (`Screen::read`) and tested against captured Claude Code 2.1.280 screens;
  update those fixtures when the pinned Claude Code changes its wording.
  `claude_auth.rs` reads `claude auth status --json` (only `claude.ai` logins
  count) for the account and `loginExpiresAt`; sign-out runs
  `claude auth logout`. `claude_sign_in_cancel` interrupts URL/code waits
  before taking the sign-in mutex and closes the workspace. The capability
  reporter re-reads the sign-in every minute and reports at once when it
  changes. ACP trace logs contain only direction and byte counts. Spans:
  `macrod.computer.control`, `macrod.claude.sign_in.start`/`.complete`,
  `macrod.claude.sign_out`.
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
  by the `test_macrod_update` workflow on Linux, macOS and Windows.
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
(gRPC). Only enrollment (`run_enroll`, `macrod.enroll.claim`) and capability
report spans export, with the marker's computer UUID as a resource attribute.
Enrollment joins the setup trace from `Enrollment.traceparent` and retains only
that W3C context in `/var/lib/macrod/provision.traceparent`.
A daemon started within an hour of enrollment is part of setup: its claim and
first successful capability report send the setup `traceparent` (the raw parent
when this daemon exports nothing). stdout remains the daemon protocol.
