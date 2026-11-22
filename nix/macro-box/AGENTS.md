# nix/macro-box

## What it is

The Macro computer guest: a NixOS configuration with macrod, harnessd, Claude Code,
herdr, Chromium on Xvnc + Openbox, Docker and nix-ld. It ships as a
Firecracker microVM image (restored from a golden snapshot) and a Docker
image with systemd as PID 1 (for the dev-only DockerFleet).

## How it works

- `_guest.nix` is the whole machine as one NixOS module: users, the macrod
  units, the desktop user services, `/etc/skel`, Claude Code settings,
  packages, Docker, nix-ld and envfs. Options under `macro.box` take macrod
  and harnessd (required), Claude Code, the ACP adapter, chrome-devtools-mcp and the
  enrollment source.
- `_container.nix` is the same guest with `boot.isContainer`, enrollment
  from `file:/run/macro/enrollment.json`, and no networkd or resolved (Docker
  owns the network); `dockerTools.buildLayeredImage` packs it with the system's
  `init` as the entrypoint.
- `_firecracker.nix` is the guest as a Firecracker microVM: a kernel with
  everything built in and no modules (`kernel/firecracker-x86_64.config`:
  Firecracker's CI microVM config plus `kernel/macro-box.fragment` for
  Docker, the nix sandbox, envfs and the firewall), booted as `vmlinux` with
  no initrd (stage 2 remounts `/dev/vda`
  read-write), and `make-disk-image` with no partition table for the root.
  `_firecracker-restore.nix` is its restore contract, below; it is separate
  so the NixOS test runs it in QEMU.
- `macro-box.nix` is the flake-parts module: `nixosConfigurations.macro-box`
  (the container guest), the packages below, and the checks.
- `_claude-agent-acp.nix` builds the Claude Code ACP adapter from
  `claude-agent-acp/package-lock.json` (without the SDK's per-platform Claude
  binaries); tmpfiles link it where macrod installs adapters,
  `~macro/.macrod/adapters/<package>@<version>`, so macrod never runs npm.
- `_agent.nix` (imported by `_guest.nix`, options `macro.box.agent.*`) runs
  the agent teammate: `packages/starter-agent` on `packages/muppet`.
  `_agent-runtime.nix` builds its `node_modules` from the starter agent's own
  `bun.lock` (one fixed-output fetch), with `@macro-inc/muppet` and
  `@macro-inc/observability` (TypeScript source) and `@macro-inc/sdk` (built
  against those packages) beside them.
  `_computer-use-linux.nix` builds computer-use-linux (MIT) from source at a
  pinned release.
- `files/` holds the enrollment probe script, the agent's `start-agent`,
  `agent-stopped` and `git-credential-agent`, the VM test's git server and
  computer-use client, and `/etc/claude-code/CLAUDE.md`;
  `skills/` is copied into `/etc/skel/.claude/skills` and macro's home.
- herdr is built from the `herdr` flake input (`github:herdrdev/herdr/v<version>`)
  with its own `nix/package.nix`, and its official skill
  (`skills/herdr/SKILL.md`, Apache-2.0, with `LICENSE` beside it) comes from
  the same source. Evaluation fails when the input's tag differs from the
  version in its `Cargo.toml`. herdr sets `HERDR_ENV=1` in its panes, which
  the skill requires. To upgrade, change the tag in `flake.nix` and run
  `nix flake lock --update-input herdr`.

## Outputs

- `nix build .#macro-box-docker` → `docker load < result` → `macro-box:latest`.
- `nix build .#macro-box-agent-docker` (`macro-box-agent:latest`): an agent
  teammate's computer, the same guest with `macro.box.agentMode = true`
  (macro has no sudo and no docker). The fleet picks it for a computer with
  an agent.
- Every image takes macrod and harnessd from `.#macro-box-macrod` and
  `.#macro-box-harnessd` (`nix/cloud-storage.nix`): release builds from each
  crate's closure in `.github/workspace-dep-closures.json`, over deps built
  once per `Cargo.lock`, so a change outside that closure (or any web change)
  reuses them. The desktop app's sidecar keeps `.#macrod` (`tauri-desktop.nix`).
  A local stack builds both Docker images only with `run_local --computers docker`.
- `nix build .#macro-box-firecracker` → `result/{vmlinux,rootfs.ext4,boot_args}`
  (`nixosConfigurations.macro-box-firecracker`). `boot_args` has no `root=`:
  the rootfs is the read-write root drive (`is_root_device`), copied per VM.
  `boot_args` turns the serial port off (`8250.nr_uarts=0`: a guest could
  flood the host's log); `macro.box.firecracker.serialConsole = true` gives a
  console on ttyS0 for debugging an image by hand.
- `nix build .#macro-box-claude-code` → the pinned model-compatible Claude Code.
- `nix build .#macro-box-harnessd` → the harnessd binary (and
  `.#macro-box-macrod` → macrod) the images bake in.
- `nix build .#macro-box-claude-agent-acp` → the ACP adapter npm prefix.
- `nix build .#macro-agent-runtime` → the agent's `node_modules` and the
  `bun.lock` it was installed from.
- `nix build .#macro-box-computer-use-linux` → the computer-use MCP server.
- `nix build .#nixosConfigurations.macro-box.config.system.build.toplevel` →
  the system closure, without packing the image.

## Contract with macrod and the computers control plane

- `macrod-enroll.service` (oneshot, root, `Before=macrod.service`) runs on
  every boot: `macrod enroll --from $MACRO_ENROLL_FROM --config
  /home/macro/.macrod/macrod.toml`. `macro.box.enrollFrom` sets the source
  (`mmds` or `file:<path>`; no default). The marker `/var/lib/macrod/enrolled` holds
  `<computer id>\n<generation>`; a newer generation re-enrolls, and no source
  with a marker means already enrolled. `check-enrollment-source` runs first:
  it fails with a reason when there is no source and no marker, and passes
  when the marker
  exists, leaving the decision to `macrod enroll`. Enroll
  writes only `macrod.toml` (owned by `macro`), the credential and the
  marker; it installs no units (`/etc/systemd/system` is read-only on
  NixOS). It restarts on failure every 10 s with no start limit, and its
  `ExecStartPost` starts macrod, so a retry that succeeds after boot still
  does. `OnSuccess=` would never fire: with `RemainAfterExit` the unit stays
  active.
- `macrod.service` runs `macrod service` as `macro` (Claude Code refuses
  permission bypass as root), workspace `/home/macro/work`, after
  `macrod-enroll.service`, which it `Wants` (not `Requires`, so a failed first
  attempt does not fail it) and whose marker it needs
  (`ConditionPathExists`). It restarts after 1 s, backing off to 30 s, and
  never hits a start limit.
- One agent per computer. With an agent, `macrod enroll` writes
  `/var/lib/macrod/agent.env` (KEY=VALUE, one line each, 0600, owned by
  `macro`) and rewrites it on re-enrollment; without one the file is absent.
  `macro-agent.path` (`PathChanged` on it and on the runtime's restart
  marker `~macro/agent/.restart`) restarts `macro-agent.service`, so
  writing, rewriting or removing the file starts, restarts or stops the
  agent (`ConditionPathExists`). `start-agent` exports the file's
  `OTEL_EXPORTER_OTLP_ENDPOINT` (telemetry, not a credential) to the runtime,
  with `OTEL_EXPORTER_OTLP_HEADERS=x-macro-computer-id=<MACRO_COMPUTER_ID>`
  (unauthenticated, so the analytics proxy ignores it until the id is signed); everything else stays
  a credential. `macro-agent-apply` also installs the
  setup traceparent macrod staged (`setup-traceparent` in the inbox) once, as
  `/run/macrod/agent-traceparent` (root, 0644, at most 128 bytes; a failure
  never stops the environment's install), and `start-agent` exports it as
  `MACRO_SETUP_TRACEPARENT` for the first start only (it records the one used
  in `~macro/agent/state/setup-traceparent`). It times its own steps and
  passes them as `MACRO_LAUNCH_TIMINGS`, which the runtime exports as
  `agent.launch.*` spans (the script has no exporter).
- `macrod.service` loads `/var/lib/macrod/telemetry.env` (written by
  `macrod enroll` from the enrollment's telemetry intake) when present, so
  macrod's setup spans export there.
- The agent's units exist only with `macro.box.agentMode` (the
  `macro-box-agent` images), where macro has no sudo or docker.
- `macro-agent.service` is a system unit running as `macro`, the user
  harnessd keeps Claude's sign-in for. It binds that sign-in
  (`macro.box.harnessd.stateDirectory` + `/claude`) read-only and names it
  in `HARNESSD_STATE_DIRECTORY`; the image's `claude` wrapper reads it.
  `KillMode=process`: calls outlive a restart.
- The agent and every unit of its desktop share one sandbox, in
  `macro-agent.slice`: user `macro` with group `macro-agent`,
  `ProtectHome=tmpfs` with only `/home/macro/agent` (its `HOME`) bound,
  nothing of `/run/user/1000` (macro's user manager and session bus would
  run anything outside it), no capabilities, `NoNewPrivileges`,
  `ProtectSystem=strict` with `/run/macro-agent` writable, and one private
  `/tmp` (`JoinsNamespaceOf` the display), which holds only `:1`'s socket.
  They keep user namespaces (Chromium's sandbox) and W+X memory (JITs). The
  firewall rejects group `macro-agent` on 127.0.0.1:5900 and :9222 (macro's
  own VNC and DevTools), and neither Xvnc listens on an abstract socket.
- A person's take-over of the agent's screen freezes `macro-agent.service`:
  `macro-agent-pause.socket` (`/run/macro-agent-pause/sock`, in a root:macro
  0750 directory the sandbox hides whole with `InaccessiblePaths`, since the
  agent is in group `macro` too) runs `files/macro-agent-pause` per
  connection: `freeze|keep|thaw <drive>`, under one `flock`, fenced by the
  drive in `/run/macro-agent-pause/paused`; a drive the harness thawed is
  remembered (`ended`, the last 64) and never frozen again. A freeze arms a
  transient timer (`macro-agent-autothaw-*`, 180 s, re-armed by `keep`; a new
  one is armed before the old one stops) that thaws the unit on its own. A
  thaw that doesn't take keeps the fence and the timer. The harness asks over the fleet's exec. A restart asked for while
  frozen (`macro-agent-restart`) waits for the thaw. The agent's Xvnc runs
  with `-SendPrimary=0`. `checks.macro-box-agent-pause` tests the helper
  against a fake systemctl, including a late thaw racing a newer freeze. No
  CI job builds the macro-box checks (`macro-box-agent-pause`,
  `macro-box-boot`): run `nix build .#checks.x86_64-linux.<check>` by hand
  when you change `nix/macro-box`.
- agent.env is a systemd credential (`LoadCredential`), never process
  environment: the runtime reads `MUPPET_CREDENTIALS_FILE`
  (`/run/credentials/macro-agent.service/agent.env`). The runtime contract
  (env, exit codes, last-good) is in `packages/muppet`'s docs; the unit sets
  `AGENT_WORKSPACE=/home/macro/agent/workspace`, `MUPPET_LAST_GOOD_FILE`,
  `MUPPET_RESTART_FILE`, `MUPPET_MCP_SERVERS_JSON` (computer-use-linux on the
  agent's display), `MUPPET_BROWSER_CDP_URL`, `DISPLAY`, the agent's bus,
  `PULSE_SERVER`, LiveKit's ffmpeg and the libstdc++ path. A call shares `:1`
  (`ffmpeg-x11grab`) and records the default sink's monitor (`parec`).
- `start-agent run` reads `MACRO_REPO_URL` (HTTP(S), no credentials),
  `MACRO_REPO_TOKEN`, `MACRO_AGENT_USER_ID` (`macro|email`) and
  `MACRO_AGENT_NAME` from the credential file (missing or invalid: exit 78),
  clones into a staging sibling on first start, points `origin` at the
  current URL, sets git's identity and the exact-repo credential helper
  (`git-credential-agent <credential file>`, never the token), links the
  image's `node_modules` (a `bun.lock` that differs from the image's is
  adopted and committed, unless the agent changed `package.json` from the
  template's first commit; then the boot fails: new packages need a new
  image), then execs `bun cli.ts run`. Exit 0 (stop) and 75 (restart after a
  land) are not failures; 78 counts unless the boot was on last-good.
  `agent-stopped` (`ExecStopPost`) counts
  any other exit before the runtime wrote `~/agent/state/last-good` for that
  boot's HEAD, and after 3 the next start
  rolls back with a commit of last-good's tree on top of the broken head,
  which the runtime's next sync pushes, so a pull can't undo it.
- The agent's desktop is five system units in that sandbox, none in
  macro's session: `macro-agent-display` (Xvnc `:1`, VNC 127.0.0.1:5901),
  `macro-agent-openbox` (what its menu starts stays in the sandbox),
  `macro-agent-bus` (a session bus at `/run/macro-agent/bus` that activates
  only AT-SPI), `macro-agent-sound` (PulseAudio at
  `/run/macro-agent/pulse/native` with the default null sink `agent`, whose
  monitor a call records) and `macro-agent-browser` (Chromium with forced
  accessibility, profile `~macro/agent/browser`, DevTools on 127.0.0.1:9223
  as `MUPPET_BROWSER_CDP_URL`). They and computer-use-linux get
  `GSETTINGS_SCHEMA_DIR` with GNOME's `toolkit-accessibility` on by default
  (there is no dconf), which computer-use-linux needs before it reads a tree.
  `xclip` is on the unit's PATH for the clipboard.
- `harnessd.service` runs `harnessd serve` as `macro` (socket
  `/run/harnessd/harnessd.sock`, RuntimeDirectory 0700; restarts always) with
  the unwrapped pinned Claude Code. The control plane execs `harnessd` (the
  client, on PATH) through the fleet. Its state, the Claude credential
  `<state>/claude/credential.json`, is `/home/.system/harnessd` with a data
  disk, else `/var/lib/harnessd` (tmpfiles, macro, 0700). See
  `crates/harnessd/AGENTS.md`.
- `claude` on PATH (and so macrod's `CLAUDE_CODE_EXECUTABLE`) is
  `_claude-wrapper.nix` over `files/claude-wrapper`: when the credential file
  has a token it unsets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_API_KEY` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and
  exports `CLAUDE_CODE_OAUTH_TOKEN` (the customer's plan); with no file it
  changes nothing (Macro credits); an unreadable file or one without a token
  keeps the gateway env and warns on stderr without the token. Never write
  `~/.claude/.credentials.json`.
- Its `--ignore-stdin-eof` keeps systemd's closed stdin from stopping the daemon.
- Both units get PATH `/run/wrappers/bin:/run/current-system/sw/bin`, so agents
  find the same tools as a login shell.
- New users get `/etc/skel`: the default skills and the chrome-devtools MCP
  entry in `~/.claude.json`, as real files; macro's home is seeded from it.
  `~/.claude.json` also carries the settings Claude Code's first start writes
  (`_claude-first-run.nix` runs the pinned Claude Code once at build time
  against the stand-in model in `files/warmup-turn.mjs`), only booleans and
  `migrationVersion`, never a per-install id: without them a computer's
  first session spends 0.3-1.3 s more in `session/new`.
- User services for `macro` (lingering, `ConditionUser=macro`):
  `macro-display` (Xvnc `:0`, VNC 127.0.0.1:5900, no auth, no
  readiness-probe blacklist), `macro-openbox`, `macro-chromium` (profile
  `~/.config/chromium`, CDP 127.0.0.1:9222), and
  `macro-chrome-devtools-mcp.socket` (`files/mcp-spare.mjs`): socket
  activation on `~/.cache/macro-mcp/chrome-devtools.sock`, so nothing runs
  until a computer's first session connects; that session's chrome-devtools
  MCP server starts then, and after it answers one more is started and kept
  loaded for the next session. skel's MCP entry is `socat` to that socket,
  so every session after the first gets a server that answers in
  milliseconds instead of loading for ~0.6 s before the first turn (Claude
  Code waits for it). Each session still gets its own server process. The
  socket is in macro's home, out of the agent sandbox's reach.
  chrome-devtools-mcp preloads `files/cdp-wait.mjs`: its lookup of
  Chromium's DevTools endpoint retries a refused connection for up to 10 s,
  so a browser call made right after a restore, before Chromium listens on
  9222, waits instead of failing.

## Firecracker computers

The host boots `macro-box-firecracker` once with no identity, snapshots it,
and restores every computer from that snapshot. Contract with the host:

- Drives: the rootfs first (`/dev/vda`), the computer's volume second
  (`/dev/vdb`). The golden boot has a placeholder under 64 MiB there and never
  mounts it; the host points the drive at the computer's volume, an ext4
  filesystem, before resuming.
- MMDS v2 on the one NIC (`eth0`, static `169.254.0.2/16` from the image).
  The golden VM has MMDS but no `macro.identity` (404 → nothing happens; an
  unreachable MMDS fails `macro-restore`). Before resuming a restore, or
  starting a computer from its own disk, the host puts
  `{"macro": {"identity": {"id", "time_unix_ms", "network": {"address",
  "gateway", "dns" (at least one resolver), "mac"?}}, "enrollment":
  <Enrollment>}}` and removes
  `macro.enrollment` once macrod connects.
- `macro-restore.service` (oneshot; restarts after 50 ms on failure, a
  safety net: the failing command is in the journal) runs at every boot, and the
  host starts it after every restore and wake through its guest agent
  (`systemctl start macro-restore.service`; its exit status is the result,
  and it logs each step's milliseconds and writes them to
  `/run/macro-restore/timings.json`). The guest cannot see a restore itself: the
  6.18 vmgenid driver reseeds the kernel RNG and sends no uevent. It steps the
  clock forward to `time_unix_ms` when the guest is behind (never back).
  A wake (same `id` as last applied, `/home` mounted) stops there. Otherwise,
  for a new `id` it writes a new `/etc/machine-id` (boot_id stays the
  golden's: set once per boot, nothing keys on it); it sets the address,
  default route and DNS with `ip`/`resolvectl` (the guest keeps the golden's
  MAC: each computer has its own netns, and changing it takes eth0 down) and writes the same in
  the drop-in `/run/systemd/network/10-eth0.network.d/identity.conf` (a
  `/run` file named like the image's `/etc` one would lose to it; static, no
  DHCP or router advertisements, so no DUID); waits for the volume's new
  size, drops the placeholder's block cache, requires an ext4 filesystem
  (the host attaches the volume formatted: no mkfs or resize on this path)
  and lets systemd mount `/home` on the way to macrod (`home.mount`, no fsck,
  asserts `/run/macro/home-ready`, so nothing mounts the placeholder). It
  starts, without waiting,
  `macro-home.target` (`macro-home-setup`: macro's home, tmpfiles for
  `/home` and lingering for the desktop; then macrod-enroll, macrod,
  harnessd) and `macro-restore-settle` (networkd reads the drop-in;
  journald and systemd-random-seed restart for a new identity; timesyncd
  restarts).
- The host sizes the rootfs before the golden boot (systemd-growfs grows it
  then). It may grow either drive later (patch it to a larger file); the
  kernel's `RESIZE=1` uevent starts the `macro-grow@` instance for it, which
  runs `systemd-growfs` on the drive's mount point (`resize2fs /dev/vda`
  fails: /proc/mounts names the kernel-mounted root `/dev/root`).
- No systemd unit has a watchdog (`WatchdogSec=0` drop-ins for every
  systemd daemon that ships one): a resume advances the clocks by the
  golden's age or the hibernation's length (kvm-clock with the host's
  `clock_realtime`), which would fire every watchdog at once and kill
  networkd, resolved and journald. macro-restore also retries `resolvectl`
  for a second while resolved starts.
- Until then nothing that needs `/home` runs: those units are wanted by
  `macro-home.target`, Docker starts only from its socket and requires
  `home.mount`, and macro does not linger. `macro-prewarm` reads their
  programs into the page cache so the snapshot holds them.
- `firecracker-guest-agent.service` (root, from boot, also in the golden
  boot) runs the host's programs over vsock port 1024
  (`services/firecracker_guest_agent`). The host snapshots the golden boot once
  `systemctl is-system-running --wait` answers through it: `macro-prewarm`
  is a oneshot of `multi-user.target`, so that waits for it too.
- Only root reaches MMDS, which holds the enrollment until it is claimed:
  the firewall rejects other users' packets to 169.254.169.254 and drops
  forwarded ones (Docker containers).
- Nothing that makes a long-lived secret runs before a restore: every
  computer can read the golden snapshot's memory.
- Enrollment reads `macro.enrollment` from MMDS (`macro.box.enrollFrom =
  "mmds"`); no credential is in the image or the snapshot.
- One image and one golden for a person's computer and an agent teammate's.
  The Firecracker image is built with `agentMode` (macro has no sudo rule or
  docker group in /etc; the agent's units exist). `macro-restore` reads
  `macro.identity.role` (required: the host always sends it) once per identity, before
  anything of macro's runs, and writes it to `/run/macro/role`: `person` →
  `/run/sudoers.d/macro` (NOPASSWD, sudo's `@includedir /run/sudoers.d`) and
  an ACL `user:macro:rw` on `/run/docker.sock`; `agent` → no sudo or Docker,
  `/run/macro-agent-inbox` (macro, 0700) and `macro-agent.target`, which
  alone wants the agent, its path unit and its desktop units. macrod stages
  an `ApplyAgent` environment at `/run/macro-agent-inbox/agent.env` (it
  refuses without the directory); `macro-agent-apply.path` starts a root unit
  that refuses unless `/run/macro/role` is `agent`, reads and empties the
  inbox only as macro (`setpriv`; a symlink macro plants can't make root
  read or write through it), caps it at 64 KiB, installs it as
  `/var/lib/macrod/agent.env` (0600, macro) and empties the inbox; the
  agent's own path unit then starts it.

## Running the Docker image

```sh
docker run -d --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
  -v ./enrollment.json:/run/macro/enrollment.json:ro macro-box:latest
```

`--tmpfs /run` keeps systemd from mounting its own `/run` over the
enrollment bind mount. Without the mount, `macrod-enroll` fails with the
missing-file message (`docker exec <id> journalctl -u macrod-enroll`).

## Data disk and image updates

A running computer is updated by replacing its root disk with a new image,
never by `nixos-rebuild` inside the guest. Everything that must survive lives
on the data disk: the block device `macro.box.dataDisk` (null keeps state on
the root disk, as Docker guests do), formatted ext4 on first boot, grown with
the volume, and mounted at `/home` in the initrd. It holds every home
(`~macro/work`, `~/.claude`, `~/.macrod` with `macrod.toml`, the Chromium
profile) and `/home/.system/macrod`, which `/var/lib/macrod` links to (the
enrollment marker), and Docker's data root `/home/.system/docker`. The root
disk, `/etc/passwd` included, comes from the image: users created at runtime
and `nix profile` installs do not survive. Size the volume for Docker images
too. After an update, `macrod-enroll` finds the marker on the data disk and no
newer generation, and keeps the enrollment; macrod reconnects with its
existing credentials: no new pairing and no Claude login.

## Checks

- `nix build .#checks.x86_64-linux.macro-box` boots `_guest.nix` in a NixOS
  test VM: enrollment fails with its reason, macrod's ordering and user, a
  late enrollment still starts macrod,
  `macrod detect-agents` reports Claude Code with nothing to install, the
  tools are on macro's PATH, a downloaded glibc binary runs through nix-ld,
  and Xvnc and Chromium's CDP port come up, and the chrome-devtools MCP
  connector in `~/.claude.json` reaches a server that answers `initialize`
  (socket-activated: nothing runs before the first connection), and a
  browser call made while Chromium is still starting succeeds. A second image then boots from
  the first one's data disk and keeps the home files, Claude credentials and
  enrollment marker; enrollment runs and its check passes without a source.
  A third VM boots the guest in agent mode: macro has no sudo or docker
  group; the agent stays down without `agent.env`; its Chromium serves
  DevTools on loopback only with a profile under its home; the `agent` sink
  and its monitor exist; the clipboard round-trips on `:1`; AT-SPI reports
  `IsEnabled`; computer-use-linux lists Chromium's
  window, reads its AT-SPI tree and returns a screenshot PNG; the agent rejects a credentialed repo URL without
  contacting the repo; a rewritten file restarts it, and it clones from an
  in-VM git server, links the image's packages and runs, without its
  credentials in its environment or the rest of macro's home in its view;
  neither the agent's unit nor Openbox can reach `systemd-run --user`,
  macro's session bus, its files, `:0`, 5900 or 9222, and the agent's
  browser can't open macro's files or DevTools;
  `claude` in its unit keeps the gateway environment without a sign-in and
  gets `CLAUDE_CODE_OAUTH_TOKEN` from a (fake) `credential.json`, which it
  cannot write;
  three failed boots of a broken commit roll the workspace back to last-good;
  the restart marker restarts it; removing the file stops it.
  A fourth VM enrolls from a file against `files/test-fake-macro.py` on
  loopback while `network-online.target` never comes: the claim and macrod's
  runtime connection still go through, and neither unit is ordered after it.
- The agent runtime (`packages/muppet` and the starter agent's packages)
  reaches agents only in a new image; a harness deploy changes only the
  seeded starter agent. Release the two together
  (`docs/runbooks/firecracker-computers-rollout.md`).
- After `packages/starter-agent/bun.lock` changes, update `outputHash` in
  `_agent-runtime.nix` from the fetch derivation's reported `got:` hash.
- To upgrade computer-use-linux, change `version` in
  `_computer-use-linux.nix` and take `hash`, then `cargoHash`, from the
  build's `got:` lines.
- `nix build .#checks.x86_64-linux.macro-box-firecracker-restore` boots the
  guest with `_firecracker-restore.nix` in QEMU (stock kernel and disks),
  a stand-in MMDS (`files/test-mmds.py`): the
  golden boot leaves `/home`, macrod, harnessd, Docker and macro's session
  down; the host's `systemctl start macro-restore` after writing an identity
  steps the clock, sets a
  new machine id, the address and MAC, mounts the (host-formatted) `/home` and starts
  harnessd and macro's session, and enrollment fails with the MMDS reason;
  `block_resize` of the volume grows the mounted `/home`; a
  repeat with the same id is a wake and keeps the machine id and files, another id changes
  it, and a cold boot mounts `/home` at boot. The first identity is a
  person's (macro has sudo and the Docker socket, no agent units); the second
  an agent's (no sudo; the agent's desktop runs; an environment macro puts
  in the inbox is installed as `/var/lib/macrod/agent.env`, 0600 macro).
- `nix build .#checks.x86_64-linux.macro-box-claude-wrapper` runs
  `files/claude-wrapper` against a fake claude: no credential, a credential,
  an unreadable one and one without a token.
- `nix build .#checks.x86_64-linux.macro-box-boot` runs
  `files/test-start-agent.sh`: start-agent's lock adoption, rollback and
  muppet API check (the code's `muppetApi` against the image's `apiLevel`), and
  agent-stopped's failure count, against local git repositories.
- `nix build .#checks.x86_64-linux.macro-box-claude-agent-acp` runs ACP
  `initialize` against the adapter. Evaluation fails when its version differs
  from macrod's pin in `crates/coding_agent_worker/src/tui/agent_catalog/claude_code.rs`;
  run `claude-agent-acp/lock.sh` after changing the pin.
- `nix build .#macro-box-claude-code`: keeps nixpkgs' binary patching, wrapper
  and version check. `_claude-code.nix` pins the minimum version required by
  the models computers default to. Regenerate its hash from that version's
  upstream `https://downloads.claude.ai/claude-code-releases/<version>/manifest.json`
  (`platforms.linux-x64.checksum`) when upgrading.
- `nix build .#macro-box-docker` and the Docker smoke test above.

- `nix/macro-box/kernel/update.sh` regenerates the Firecracker kernel config
  after a change to the fragment, the pinned Firecracker revision or nixpkgs'
  6.18 kernel; it fails when a fragment line does not survive
  `olddefconfig` (an unmet dependency). A module the guest needs must go in
  the fragment: the kernel loads none.

## Gotchas

- import-tree imports every `.nix` file under `nix/`; helpers start with `_`.
- Declare everything as NixOS options; keep shell only for runtime logic
  (the enrollment probe, waiting for the X socket).
- `/etc/systemd/system` is read-only on NixOS: declare units here, never at
  runtime.
- Keep state that must survive an update on the data disk. A sandboxed unit
  that needs it uses `ProtectHome=tmpfs` with `BindPaths`; `ProtectHome=yes`
  hides it.
- The NixOS test VMs replace `fileSystems`, so `_vm-test.nix` declares the
  data disk mount again.
- `environment.etc` entries that `useradd` copies or programs rewrite need a
  `mode`, or they are symlinks into the store.
- DockerFleet enforces recorded vCPU and memory limits through cgroups without
  CPU pinning; dev-only Docker guests still see host totals in `/proc` and
  `nproc`. Do not add lxcfs.
- No managed `managed-mcp.json`: it takes exclusive control of MCP servers and
  would block the Macro servers macrod forwards; chrome-devtools is
  registered in user scope instead.
