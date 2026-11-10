# nix/macro-box

## What it is

The Macro computer guest image: Ubuntu 24.04 built by Nix from hash-pinned
debs, with macrod, Claude Code, herdr, Chromium, Xvnc + Openbox and Docker.
One rootfs ships two ways: an Incus VM image (for the computers IncusFleet)
and a Docker image (the dev-only DockerFleet).

## How it works

- `lock.sh` resolves `packages.txt` (plus every Essential/required package)
  with apt against a pinned `snapshot.ubuntu.com` timestamp into
  `debs.lock.json` (URL + SHA512 per deb; `base` marks the required closure;
  `efi` holds the signed shim + GRUB, unpacked for the ESP, never installed).
- `rootfs.sh` runs in the Nix sandbox under `unshare --user --map-root-user
  --mount`: unpack the base debs, chroot, then Ubuntu's own dpkg installs
  every deb under Ubuntu's `fakeroot`, which records the ownership one mapped
  uid cannot hold. The Nix closure of `tools` (macrod, claude-code, chromium,
  Node 24, herdr, chrome-devtools-mcp) is copied into the guest's `/nix/store`
  and linked from `/usr/local/bin`. `_claude-agent-acp.nix` builds the Claude
  Code ACP adapter from `claude-agent-acp/package-lock.json` (without the SDK's
  per-platform Claude binaries); `rootfs.sh` links it where macrod installs
  adapters, `~macro/.macrod/adapters/<package>@<version>`, so macrod never runs
  npm. `files/` supplies scripts and documentation;
  `_config.nix` renders configuration from attrsets into the same rootfs overlay.
- `_build.nix` packs `rootfs.tar` into `disk.qcow2` (GPT: ESP with shim →
  signed GRUB → `/boot/vmlinuz`, ext4 root via `mkfs.ext4 -d tar`) plus
  `metadata.tar.xz`, and `container.tar` (no kernel/modules) into a
  docker-save archive. `macro-box.nix` is the flake-parts module.

## Outputs

- `nix build .#macro-box-incus` → `result/{metadata.tar.xz,disk.qcow2}`.
- `nix build .#macro-box-docker` → `docker load < result` → `macro-box:latest`.
- `nix build .#macro-box-rootfs` → the two tarballs.
- `nix build .#macro-box-claude-code` → the pinned model-compatible Claude Code.
- `nix build .#macro-box-claude-agent-acp` → the ACP adapter npm prefix.
- `nix build .#macro-box-config` → generated rootfs config, Incus metadata, GRUB,
  and Docker enrollment config without building the Rust/tool closure.

## Contract with macrod and the computers control plane

- `macrod-enroll.service` (oneshot, root, `ConditionPathExists=!/var/lib/macrod/enrolled`,
  `Before=macrod.service`) runs `macrod enroll --from $MACRO_ENROLL_FROM
  --config /home/macro/.macrod/macrod.toml`. `/etc/macro/enroll.env` sets
  `incus` on VMs and `file:/run/macro/enrollment.json` in Docker;
  `check-enrollment-source` fails first, with a reason, when the source is
  missing. Enroll must leave `macrod.toml` owned by `macro`, create persona
  users and units, then touch `/var/lib/macrod/enrolled`.
- `macrod.service` runs `macrod service` as `macro` (Claude Code refuses
  permission bypass as root), workspace `/home/macro/work`.
- Its `--ignore-stdin-eof` keeps systemd's closed stdin from stopping the daemon.
- Persona users get `/etc/skel`: the default skills and the chrome-devtools
  MCP entry in `~/.claude.json`. `/etc/macro/personas/` is root-only (0700).
- User services for `macro` (lingering): `macro-display` (Xtigervnc `:0`,
  VNC 127.0.0.1:5900, no auth, no readiness-probe blacklist), `macro-openbox`, `macro-chromium` (profile
  `~/.config/chromium`, CDP 127.0.0.1:9222).

## Running the Docker image

```sh
docker run -d --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
  -v ./enrollment.json:/run/macro/enrollment.json:ro macro-box:latest
```

`--tmpfs /run` keeps systemd from mounting its own `/run` over the
enrollment bind mount.

## Importing into an Incus host (runtime-dev-1)

```sh
nix build .#macro-box-incus
scp result/metadata.tar.xz result/disk.qcow2 root@runtime-dev-1:/tmp/
ssh root@runtime-dev-1 \
  'incus image import /tmp/metadata.tar.xz /tmp/disk.qcow2 --alias macro-box --reuse && rm /tmp/metadata.tar.xz /tmp/disk.qcow2'
```

Smoke test: `incus launch macro-box t --vm --profile macro-box`, then
`incus exec t -- systemctl is-system-running` and
`incus exec t -- curl -s --unix-socket /dev/incus/sock http://custom.socket/1.0/config`.

## Checks

- `nix build .#macro-box-claude-agent-acp` (and `nix flake check`, which runs
  ACP `initialize` against it). Evaluation fails when its version differs
  from macrod's pin in `crates/coding_agent_worker/src/tui/agent_catalog/claude_code.rs`;
  run `claude-agent-acp/lock.sh` after changing the pin.
- `nix build .#macro-box-claude-code`: keeps nixpkgs' binary patching, wrapper
  and version check. `_claude-code.nix` pins the minimum version required by
  the models computers default to. Regenerate its hash from that version's
  upstream `https://downloads.claude.ai/claude-code-releases/<version>/manifest.json`
  (`platforms.linux-x64.checksum`) when upgrading.
- For config-only edits, build `.#macro-box-config` and diff its rendered files
  against the previous generation (parse INI/JSON/YAML when ordering changes).
- Inside a running guest as root, run `bash tests/enrollment-agent-detection.sh`
  (copy it from this directory); it discovers Claude using the enrollment unit's
  environment in a fresh system service, with no adapter left to install.
- After `packages.txt` changes: `nix/macro-box/lock.sh`, then rebuild both outputs.
- `nix build .#macro-box-incus .#macro-box-docker`, then the Docker smoke
  test above without the enrollment mount: `macrod-enroll` must fail with the
  missing-file message (`docker exec <id> journalctl -u macrod-enroll`).

## Gotchas

- DockerFleet enforces recorded vCPU and memory limits through cgroups without
  CPU pinning; dev-only Docker guests still see host totals in `/proc` and
  `nproc`. Do not add lxcfs; Incus VMs see their real CPU and memory limits.

- Set enrollment's `HOME` to `/home/macro` so agent discovery works in a root
  system service and records adapter paths usable by the unprivileged daemon.
- import-tree imports every `.nix` file under `nix/`; helpers start with `_`.
- Generate all configuration from attrsets in `_config.nix`; use Nix formats
  for INI/JSON/YAML and `lib.generators.toKeyValue` for the remaining line formats.
  Keep shell programs and Markdown in `files/`; the enrollment env is generated.
- The `macro-box` profile turns Secure Boot off, so the shim path is built
  but untested; the ESP grub.cfg boots `/boot/vmlinuz` + `/boot/initrd.img`
  (the kernel's symlinks), so apt kernel upgrades need no update-grub.
- To iterate without the Rust build, call `_build.nix` with a stub `macrod`
  (`pkgs.writeShellScriptBin "macrod" ...`) via `nix build --impure --expr`.
- Do not add Ubuntu `chromium` (a snap stub) or `nodejs` (too old for
  chrome-devtools-mcp); both come from Nix.
- The sysctl drop-in turns off Ubuntu's AppArmor userns restriction, which
  otherwise breaks Chromium's sandbox.
- No managed `managed-mcp.json`: it takes exclusive control of MCP servers and
  would block the Macro servers macrod forwards; chrome-devtools is
  registered in user scope instead.
