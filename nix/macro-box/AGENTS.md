# nix/macro-box

## What it is

The Macro computer guest: a NixOS configuration with macrod, harnessd, Claude Code,
herdr, Chromium on Xvnc + Openbox, Docker and nix-ld. It ships as an Incus
VM image (for the computers IncusFleet) and a Docker image with systemd as
PID 1 (for the dev-only DockerFleet).

## How it works

- `_guest.nix` is the whole machine as one NixOS module: users, the macrod
  units, the desktop user services, `/etc/skel`, Claude Code settings,
  packages, Docker, nix-ld and envfs. Options under `macro.box` take macrod
  and harnessd (required), Claude Code, the ACP adapter, chrome-devtools-mcp and the
  enrollment source.
- `_image.nix` adds nixpkgs' `virtualisation/incus-virtual-machine.nix`:
  `make-disk-image` builds an EFI qcow2 (systemd-boot, ext4 root by label,
  grown to the disk at boot by `boot.growPartition`), `lxc-image-metadata`
  builds the metadata tarball, and `virtualisation.incus.agent` runs
  incus-agent. It also turns off that module's interactive defaults (empty
  root password, sshd, the nixpkgs channel copy, documentation).
- `_container.nix` is the same guest with `boot.isContainer`, enrollment
  from `file:/run/macro/enrollment.json`, and no networkd or resolved (Docker
  owns the network); `dockerTools.buildLayeredImage` packs it with the system's
  `init` as the entrypoint.
- `macro-box.nix` is the flake-parts module: `nixosConfigurations.macro-box`,
  the packages below, and the checks.
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

- `nix build .#macro-box-incus` → `result/{metadata.tar.xz,disk.qcow2}`.
- `nix build .#macro-box-docker` → `docker load < result` → `macro-box:latest`.
- `nix build .#macro-box-agent` and `.#macro-box-agent-docker`
  (`macro-box-agent:latest`): an agent teammate's computer, the same guest
  with `macro.box.agentMode = true` (macro has no sudo and no docker). The
  fleet picks them for a computer with an agent. Import the Incus one as
  `macro-box-agent/<date>`.
- `nix build .#macro-box-claude-code` → the pinned model-compatible Claude Code.
- `nix build .#harnessd` → the harnessd binary.
- `nix build .#macro-box-claude-agent-acp` → the ACP adapter npm prefix.
- `nix build .#macro-agent-runtime` → the agent's `node_modules` and the
  `bun.lock` it was installed from.
- `nix build .#macro-box-computer-use-linux` → the computer-use MCP server.
- `nix build .#nixosConfigurations.macro-box.config.system.build.toplevel` →
  the system closure, without packing the disk.

## Contract with macrod and the computers control plane

- `macrod-enroll.service` (oneshot, root, `Before=macrod.service`) runs on
  every boot: `macrod enroll --from $MACRO_ENROLL_FROM --config
  /home/macro/.macrod/macrod.toml`. `macro.box.enrollFrom` sets the source
  (`incus`, or `file:<path>`). The marker `/var/lib/macrod/enrolled` holds
  `<computer id>\n<generation>`; a newer generation re-enrolls, and no source
  with a marker means already enrolled. `check-enrollment-source` runs first:
  it waits up to 60 s (`MACRO_INCUS_SOCKET_WAIT`) for `/dev/incus/sock`,
  which incus-agent creates a few seconds after it starts, then fails with a
  reason when there is no source and no marker, and passes when the marker
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
  agent (`ConditionPathExists`).
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
- User services for `macro` (lingering, `ConditionUser=macro`):
  `macro-display` (Xvnc `:0`, VNC 127.0.0.1:5900, no auth, no
  readiness-probe blacklist), `macro-openbox`, `macro-chromium` (profile
  `~/.config/chromium`, CDP 127.0.0.1:9222).

## Running the Docker image

```sh
docker run -d --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
  -v ./enrollment.json:/run/macro/enrollment.json:ro macro-box:latest
```

`--tmpfs /run` keeps systemd from mounting its own `/run` over the
enrollment bind mount. Without the mount, `macrod-enroll` fails with the
missing-file message (`docker exec <id> journalctl -u macrod-enroll`).

## Importing into an Incus host (runtime-dev-1)

`root@runtime-dev-1` goes over IAP; pass the SSH options from the Deploy
section of `nix/hosts/README.md` to `scp` and `ssh`.

```sh
nix build .#macro-box-incus
scp -L result/metadata.tar.xz result/disk.qcow2 root@runtime-dev-1:/tmp/
ssh root@runtime-dev-1 \
  'incus image import /tmp/metadata.tar.xz /tmp/disk.qcow2 --alias macro-box/<date> && rm /tmp/metadata.tar.xz /tmp/disk.qcow2'
ssh root@runtime-dev-1 \
  'incus init macro-box/<date> warm-<date> --vm --profile macro-box --storage default -c migration.stateful=false && incus delete warm-<date>'
```

The second command warms the image: Incus unpacks a new image into a cached
volume on the pool (~30s) on first use, so no customer's computer waits for it.
Use `init`, never `launch`, so the throwaway never boots or enrolls.

Smoke test: `incus storage volume create default t-data --type=block size=10GiB`,
`incus init macro-box/<date> t --vm --profile macro-box`,
`incus storage volume attach default t-data t data`, `incus start t`, then
`incus exec t -- systemctl is-system-running` and
`incus exec t -- curl -s --unix-socket /dev/incus/sock http://custom.socket/1.0/config`.

## Data disk and image updates

A running computer is updated by replacing its root disk with a new image,
never by `nixos-rebuild` inside the guest. Everything that must survive lives
on the data disk: an Incus custom block volume attached as disk device `data`
(`/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_data`, `macro.box.dataDisk`),
formatted ext4 on first boot, grown with the volume, and mounted at `/home` in
the initrd. It holds every home (`~macro/work`, `~/.claude`, `~/.macrod`
with `macrod.toml`, the Chromium profile) and `/home/.system/macrod`, which
`/var/lib/macrod` links to (the enrollment marker), and Docker's data root `/home/.system/docker`. The root disk,
`/etc/passwd` included, comes from the image: users created at runtime and
`nix profile` installs do not survive. Size the volume for Docker images too.

The control plane, per computer:

1. Once: `create_block_volume(pool, "<instance>-data", size)` and
   `attach_volume(instance, "data", pool, volume)` (or put the device in the
   instance's create request) before its first start. Without it the guest
   does not boot.
2. Build and import the new image under a new alias (below), e.g.
   `macro-box/<date>`, and keep the old alias for rollback.
3. Update: `stop` → `rebuild(instance, new alias)` → `start`. Rebuild keeps
   config (`user.macro.enrollment`), profiles and the data volume.
   `macrod-enroll` runs, finds the marker on the data disk and no newer
   generation, and keeps the enrollment; macrod reconnects with its existing
   credentials: no new pairing and no Claude login.
4. Rollback: the same steps with the old alias.
5. On deletion, `delete` the instance, then `delete_volume`; Incus does not
   delete attached custom volumes with the instance.

## Boot path

- OVMF → systemd-boot (timeout 0) → kernel + initrd; Secure Boot is off in
  the `macro-box` profile, so nothing is signed.
- `systemd-networkd-wait-online` waits for any link (30 s cap), not all.
- The kernel command line has `quiet`; `ttyS0` stays the recovery console.
- `check-enrollment-source` waits up to 60 s for the Incus socket to appear,
  checking every 0.1 s, then gives the request 2 s.
- `incus-agent` waits for its virtio port device (`_image.nix`) instead of
  starting before the virtio devices exist and restarting 5 s later.
- Docker is socket-activated (`enableOnBoot = false`): dockerd starts on the
  first `docker` call, not during first boot.
- To measure, boot `disk.qcow2` under QEMU with OVMF and read
  `systemd-analyze` from the serial console.
- Not done: a UKI as `\EFI\BOOT\BOOTX64.EFI` (skips systemd-boot) or
  `raw.qemu` direct kernel boot. Both mean leaving nixpkgs' image module.

## Checks

- `nix build .#checks.x86_64-linux.macro-box` boots `_guest.nix` in a NixOS
  test VM: enrollment fails with its reason, macrod's ordering and user, a
  late enrollment still starts macrod,
  `macrod detect-agents` reports Claude Code with nothing to install, the
  tools are on macro's PATH, a downloaded glibc binary runs through nix-ld,
  and Xvnc and Chromium's CDP port come up. A second image then boots from
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
- After `packages/starter-agent/bun.lock` changes, update `outputHash` in
  `_agent-runtime.nix` from the fetch derivation's reported `got:` hash.
- To upgrade computer-use-linux, change `version` in
  `_computer-use-linux.nix` and take `hash`, then `cargoHash`, from the
  build's `got:` lines.
- `nix build .#checks.x86_64-linux.macro-box-claude-wrapper` runs
  `files/claude-wrapper` against a fake claude: no credential, a credential,
  an unreadable one and one without a token.
- `nix build .#checks.x86_64-linux.macro-box-boot` runs
  `files/test-start-agent.sh`: start-agent's lock adoption and rollback, and
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
- `nix build .#macro-box-incus` before importing; `nix build .#macro-box-docker`
  and the Docker smoke test above.

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
  `nproc`. Do not add lxcfs; Incus VMs see their real CPU and memory limits.
- No managed `managed-mcp.json`: it takes exclusive control of MCP servers and
  would block the Macro servers macrod forwards; chrome-devtools is
  registered in user scope instead.
