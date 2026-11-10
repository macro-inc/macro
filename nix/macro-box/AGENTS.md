# nix/macro-box

## What it is

The Macro computer guest: a NixOS configuration with macrod, Claude Code,
herdr, Chromium on Xvnc + Openbox, Docker and nix-ld. It ships as an Incus
VM image (for the computers IncusFleet) and a Docker image with systemd as
PID 1 (for the dev-only DockerFleet).

## How it works

- `_guest.nix` is the whole machine as one NixOS module: users, the macrod
  units, the desktop user services, `/etc/skel`, Claude Code settings,
  packages, Docker, nix-ld and envfs. Options under `macro.box` take macrod
  (required), Claude Code, the ACP adapter, chrome-devtools-mcp and the
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
- `files/` holds the enrollment probe script and `/etc/claude-code/CLAUDE.md`;
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
- `nix build .#macro-box-claude-code` → the pinned model-compatible Claude Code.
- `nix build .#macro-box-claude-agent-acp` → the ACP adapter npm prefix.
- `nix build .#nixosConfigurations.macro-box.config.system.build.toplevel` →
  the system closure, without packing the disk.

## Contract with macrod and the computers control plane

- `macrod-enroll.service` (oneshot, root, `Before=macrod.service`) runs on
  every boot: `macrod enroll --from $MACRO_ENROLL_FROM --config
  /home/macro/.macrod/macrod.toml`. `macro.box.enrollFrom` sets the source
  (`incus`, or `file:<path>`). The marker `/var/lib/macrod/enrolled` holds
  `<computer id>\n<generation>`; a newer generation re-enrolls, and no source
  with a marker means already enrolled. `check-enrollment-source` runs first:
  it fails with a reason when there is no source and no marker, and passes
  when the marker exists, leaving the decision to `macrod enroll`. Enroll
  writes only `macrod.toml` (owned by `macro`), the credential and the
  marker; it installs no units (`/etc/systemd/system` is read-only on
  NixOS). It restarts on failure every 10 s with no start limit, and
  `OnSuccess=` starts macrod once a retry succeeds.
- `macrod.service` runs `macrod service` as `macro` (Claude Code refuses
  permission bypass as root), workspace `/home/macro/work`, after
  `macrod-enroll.service`. It restarts after 1 s, backing off to 30 s, and
  never hits a start limit.
- Claude signs in through Claude Code's own `/login`, in a herdr pane; its
  credentials stay in `~macro/.claude` on the data disk.
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

```sh
nix build .#macro-box-incus
scp -L result/metadata.tar.xz result/disk.qcow2 root@runtime-dev-1:/tmp/
ssh root@runtime-dev-1 \
  'incus image import /tmp/metadata.tar.xz /tmp/disk.qcow2 --alias macro-box/<date> && rm /tmp/metadata.tar.xz /tmp/disk.qcow2'
```

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
- `check-enrollment-source` gives the Incus socket 2 s.
- To measure, boot `disk.qcow2` under QEMU with OVMF and read
  `systemd-analyze` from the serial console.
- Not done: a UKI as `\EFI\BOOT\BOOTX64.EFI` (skips systemd-boot) or
  `raw.qemu` direct kernel boot. Both mean leaving nixpkgs' image module.

## Checks

- `nix build .#checks.x86_64-linux.macro-box` boots `_guest.nix` in a NixOS
  test VM: enrollment fails with its reason, macrod's ordering and user,
  `macrod detect-agents` reports Claude Code with nothing to install, the
  tools are on macro's PATH, a downloaded glibc binary runs through nix-ld,
  and Xvnc and Chromium's CDP port come up. A second image then boots from
  the first one's data disk and keeps the home files, Claude credentials and
  enrollment marker; enrollment runs and its check passes without a source.
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
