# nix/macro-box

## What it is

The Macro computer guest image: Ubuntu 24.04 built by Nix from hash-pinned
debs, with macrod, Claude Code, herdr, Chromium, Xvnc + Openbox and Docker.
One rootfs ships two ways: an Incus VM image (`hosted_runtimes`' IncusFleet)
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
  node 22, herdr, chrome-devtools-mcp) is copied into the guest's `/nix/store`
  and linked from `/usr/local/bin`. `files/` is copied over `/`.
- `_build.nix` packs `rootfs.tar` into `disk.qcow2` (GPT: ESP with shim →
  signed GRUB → `/boot/vmlinuz`, ext4 root via `mkfs.ext4 -d tar`) plus
  `metadata.tar.xz`, and `container.tar` (no kernel/modules) into a
  docker-save archive. `macro-box.nix` is the flake-parts module.

## Outputs

- `nix build .#macro-box-incus` → `result/{metadata.tar.xz,disk.qcow2}`.
- `nix build .#macro-box-docker` → `docker load < result` → `macro-box:latest`.
- `nix build .#macro-box-rootfs` → the two tarballs.

## Contract with macrod and hosted_runtimes

- `macrod-enroll.service` (oneshot, root, `ConditionPathExists=!/var/lib/macrod/enrolled`,
  `Before=macrod.service`) runs `macrod enroll --from $MACRO_ENROLL_FROM
  --config /home/macro/.macrod/macrod.toml`. `/etc/macro/enroll.env` sets
  `incus` on VMs and `file:/run/macro/enrollment.json` in Docker;
  `check-enrollment-source` fails first, with a reason, when the source is
  missing. Enroll must leave `macrod.toml` owned by `macro`, create persona
  users and units, then touch `/var/lib/macrod/enrolled`.
- `macrod.service` runs `macrod service` as `macro` (Claude Code refuses
  permission bypass as root), workspace `/home/macro/work`.
- Persona users get `/etc/skel`: the default skills and the chrome-devtools
  MCP entry in `~/.claude.json`. `/etc/macro/personas/` is root-only (0700).
- User services for `macro` (lingering): `macro-display` (Xtigervnc `:0`,
  VNC 127.0.0.1:5900, no auth), `macro-openbox`, `macro-chromium` (profile
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
gcloud compute scp --tunnel-through-iap --project macro-435922 --zone us-east4-b \
  result/metadata.tar.xz result/disk.qcow2 runtime-dev-1:/tmp/
gcloud compute ssh runtime-dev-1 --tunnel-through-iap --project macro-435922 --zone us-east4-b \
  --command 'incus image import /tmp/metadata.tar.xz /tmp/disk.qcow2 --alias macro-box --reuse && rm /tmp/metadata.tar.xz /tmp/disk.qcow2'
```

Smoke test: `incus launch macro-box t --vm --profile macro-box`, then
`incus exec t -- systemctl is-system-running` and
`incus exec t -- curl -s --unix-socket /dev/incus/sock http://custom.socket/1.0/config`.

## Checks

- After `packages.txt` changes: `nix/macro-box/lock.sh`, then rebuild both outputs.
- `nix build .#macro-box-incus .#macro-box-docker`, then the Docker smoke
  test above without the enrollment mount: `macrod-enroll` must fail with the
  missing-file message (`docker exec <id> journalctl -u macrod-enroll`).

## Gotchas

- import-tree imports every `.nix` file under `nix/`; helpers start with `_`.
- Keep `files/etc/macro/enroll.env` tracked despite the global `*.env` ignore;
  it contains the non-secret Incus enrollment source required at VM boot.
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
