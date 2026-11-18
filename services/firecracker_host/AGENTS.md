# firecracker_host

## What it is

Macro computers on Firecracker: the agent on each Firecracker host. It
restores computers from golden snapshots into jailed Firecracker processes
and serves `crates/firecracker_host_api` over mTLS to the control plane's
`FirecrackerFleet` (`crates/hosted_runtimes`). Incus hosts don't run it.

## How it works

Create = reflink the golden's rootfs, grow/reuse `/home`, take a netns slot,
jailer, `snapshot/load` (paused, `clock_realtime`), PATCH both drives (new
sizes), PUT MMDS (identity + enrollment), resume, kick `macro-restore` over
vsock. Power actions follow `domain::power::plan`. One record per computer
on the durable disk; at startup the agent adopts live processes, settles the
rest and removes jails no record holds (`domain/service/reconcile.rs`); a
60 s upkeep (`inbound/upkeep.rs`) repeats that for idle computers, runs the
`/health` checks and records the `firecracker_host.*` gauges. Design:
`docs/architecture/firecracker-computers.md`; threat model:
`docs/architecture/firecracker-computers-security.md`.

Moving a computer to another host (`src/domain/moves.rs`, ZFS only, on
when the config has `[moves]`): the control plane registers a ticket on
the target, then asks the source for replication rounds (`zfs send` of the
computer's dataset, pushed to the target's move listener on the host
mesh: pre-copy while it runs, then a final round after `release`), then
`adopt` on the target. `HostInfo.moveAddress` is the listener.

## Start here

- `src/inbound/axum_router.rs`: every route (utoipa paths; `ApiDoc` in
  `inbound/swagger.rs`, `cargo run --bin firecracker_host_openapi`), generic
  over the `HostOperations` port; `axum_router/test.rs` has the router tests
  and the client/server contract test.
- `src/domain/power.rs`: state × action → steps.
- `src/domain/service/reconcile.rs`: what each crash point leaves and how it
  is settled; one test per crash point in `reconcile/test.rs`.
- `src/domain/activity.rs`, `src/domain/service/pressure.rs`: `cpu.weight`
  by activity inferred from each VM's CPU (10 s samples), and the zram
  squeeze of computers quiet 30 min while host memory in use is inside the
  host limits' squeeze window (one `memory.reclaim` at a time). "Idle" for
  the squeeze is the agent's, from guest CPU; "idle" for hibernation relief
  is the control plane's (`crates/hosted_runtimes` overcommit), from
  sessions and activity it sees. The control plane sets the window.
- `src/domain/metrics.rs`: metric names and attributes, a contract with the
  monitors in `infra/stacks/monitoring`.
- `src/domain/service.rs`: operations, locking, idempotency; `service/host.rs`
  goldens, host limits and info; `service/enrollment.rs` enrollment.
- `src/outbound/jails.rs`: jailer, chroot, Firecracker calls; `jails/machines.rs`: the `Machines` port; `jails/golden_build.rs`: golden builds.
- `src/outbound/network.rs`: netns slots and nftables.
- `src/outbound/layout.rs`: what lives where on the durable disk.
- `src/domain/ports.rs` `Disks`: the storage seam (XFS reflink files in
  `outbound/disks.rs`; a ZFS implementation returns `DriveBacking::BlockDevice`
  zvols, which the jail turns into device nodes owned by the VM user).

## Gotchas

- A moving computer's dataset is `staging/<id>` (received, or released),
  never `computers/<id>`: startup loads only `computers/`, so a half-received
  record (which says running, with the source's pid) is never served.
  Staged computers are refused `create` until adopted or dropped. Golden
  snapshots received from other hosts live in `bases/<guid>`; a computer's
  first round is received as a clone of its base (`-o origin=`). Only disks
  and the record move: `release` shuts the guest down (or drops its
  hibernation), so the moved computer cold boots on its new host.

- Every step that changes a computer saves its record before the next one,
  and the record says what was in flight (`start_pending`, `hibernating`,
  `guest_restore_pending`); a new crash point needs its flag and a
  `reconcile` test.
- A hibernation is published with one rename before the VM ends; a
  hibernation present while the VM ran on is stale and gets discarded.

- `GET /v1/host` reports `agentVersion` from `FIRECRACKER_HOST_COMMIT` at
  build time (`main.rs` `AGENT_VERSION`); the Nix package
  (`nix/tauri-desktop.nix`, `firecracker-host`) sets it to the flake's rev.
- Config is one TOML file written by `nix/hosts/_nixos/firecracker-host.nix`
  (`src/config.rs`); there is no Doppler or env-var config on hosts.
- A golden's memory only matches its own rootfs: restore from a golden only
  onto a fresh reflink of the golden's rootfs (`rootfs_never_booted`); every
  later boot is a cold boot or a hibernation wake.
- The chroot paths (`/rootfs.ext4`, `/home.ext4`, `/v.sock`, ...) are baked
  into every snapshot's vmstate; renaming one invalidates every golden.
- Drives' `cache_type` and `discard` are recorded in the snapshot: `Writeback`/`true`
  when the golden is built.
- VMs live in `<unit>/vms` cgroups and outlive the agent: the unit needs
  `Delegate=yes`, `DelegateSubgroup=agent` (cgroup v2 forbids processes in a
  node with controllers on) and `KillMode=process`.

## Checks

- `cargo test -p firecracker_host`
- After changing an operation's steps or recovery: `crash-harness/run.sh` on
  a Firecracker host (kills the agent at every crash point; see its README).
  A new step between two saves gets a `CrashPoint` and a harness case.
- On a host: create, exec and destroy a computer (see the NixOS module's test).
