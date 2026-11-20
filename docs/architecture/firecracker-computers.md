# Firecracker computers: the host agent

Macro computers can run as Firecracker microVMs instead of Incus VMs, per
host. The control plane (`crates/hosted_runtimes`, `FirecrackerFleet`) drives
one agent per Firecracker host, `services/firecracker_host`, over mTLS REST:
the contract is `crates/firecracker_host_api`. Incus stays the default; see
[Macro computers](macro-computers.md) for the lifecycle above the fleet. The
isolation model and its threat analysis are in
[Firecracker computers: security](firecracker-computers-security.md).

## A purchase is a restore

Each image version is booted once per sold shape (vCPUs, memory) until the
guest settles, unenrolled: the golden. The agent pauses it and keeps a Full
snapshot. A new computer is a restore of that snapshot, not a boot:

1. Take a ready disk set from the spare pool, or `zfs clone` the golden's
   latest snapshot (ZFS, ~45 ms): the clone holds the golden's rootfs and an
   empty `/home` of every sold size, of which the computer keeps its own (new
   filesystem UUID) and deletes the rest. On XFS the rootfs and `/home` are
   reflinks of the golden's and of a per-size template. Reuse the disks a
   lost VM left; grow both to the sold sizes, never shrink.
2. Take a pre-created netns slot.
3. Jailer: own uid/gid, chroot, new pid namespace, cgroup v2 leaf with cpu,
   memory (`oom.group`) and pids limits, default seccomp filter.
4. `snapshot/load` paused, File memory backend (a private mapping of the
   golden's memory: untouched pages stay shared page cache), with
   `clock_realtime` and dirty page tracking.
5. PATCH both drives (same chroot paths, new sizes), PUT the MMDS document
   (identity, and the enrollment), resume.
6. Over vsock, run `macro-restore` in the guest: it steps the clock, takes a
   new machine id, configures the address, formats or mounts `/home`, and
   starts macrod, which enrolls from MMDS. The guest cannot tell it was
   restored, so until this succeeds the computer is restore-pending and a
   repeated create or start runs it again.

Measured on a nested n2 host: ~0.3 s from the create request to the answer,
`macro-restore` kick included.

A golden's memory matches only its own rootfs, so a golden is restored only
onto a fresh copy of the golden's rootfs. Every later boot is a cold boot of
the computer's own rootfs, or a wake from its own hibernation snapshot.

## Power

| State | Process | RAM | `start` |
| --- | --- | --- | --- |
| running | yes | yes | nothing |
| paused (`freeze`) | yes | kept | resume |
| hibernated | no | none | restore its snapshot |
| stopped | no | none | cold boot its rootfs |

`stop` is a clean shutdown (Ctrl-Alt-Del; the guest's reset ends
Firecracker), killed after a grace period. `hibernate` snapshots memory and
device state next to the computer's disks and ends the process. The plan for
every state and action is `domain::power::plan`, a pure function.

## Storage

One durable pool (a persistent disk) holds everything: records, disks,
goldens, hibernation snapshots and the jails (`outbound::layout`). If the
host stops, computers come back stopped or hibernated, never lost.

`Disks` (`outbound::disks`) is the storage port, over one of two backends:

- **ZFS** (the default): a dataset per golden and per computer under one
  parent. A golden's snapshot holds its rootfs, memory, device state and an
  empty, lazily formatted `/home` of every sold size (a few MiB each); a size
  sold later is added to every golden in a new snapshot. A computer is a
  `zfs clone` of the latest snapshot, so it shares the golden's blocks and a
  move sends only its own (`zfs send -i`). Spare disk sets (clones made
  ahead) make a create a rename.
- **XFS** with reflink: computers' rootfs and `/home` are reflinks of the
  golden's and of per-size templates.

Block cloning (ZFS BRT, `copy_file_range` across datasets) is not used to
create computers. It remains in three places, all on file moves the guest
never sees during a restore:

- **Hibernation, Diff**: the loaded memory (the golden's, or the last
  hibernation's) is cloned into the jail, and Firecracker writes the dirty
  pages into the clone.
- **Hibernation publish**: the snapshot files move from the jail into the
  computer's hibernation directory (clone, then delete).
- **Golden build**: the golden's memory and device state move from the jail
  into its dataset (clone, then delete).

So the agent refuses to start on ZFS unless the module is OpenZFS 2.4.1 or
later (2.2.x shipped block cloning with corruption bugs), the pool's
`feature@block_cloning` is on, and `zfs_bclone_enabled` and
`zfs_bclone_wait_dirty` are 1. A known cost: `zfs send` expands cloned
blocks, so a hibernated computer's move carries a full copy of the memory
it was cloned from (~350 MiB, lz4, for an 8 GiB golden) on top of its dirty
pages. Hibernating in place in the computer's own clone would remove it;
deferred until moving hibernated computers matters. Every clone runs on the
blocking pool: a clone walks every block in the kernel and would stall the
async workers.

## Network

Every VM has its own netns (a slot, pre-created at startup), with `tap0` at
172.16.0.1/30 and the guest at 172.16.0.2 in every slot, so the snapshot's
network configuration is valid in all of them. A veth pair joins the netns to
the host, NAT on both sides. nftables inside the netns accepts only the
guest's own source address; the host's table drops guest traffic to the
host, other guests, private and link-local ranges, the tailnet (except a
configured control plane), IPv6 and SMTP. 169.254.169.254 is answered by
Firecracker's MMDS inside the netns, so guests never reach the cloud
metadata server. Guests resolve through public resolvers handed to them in
MMDS.

## The agent

- Records: one JSON file per computer, replaced atomically. At startup the
  agent keeps processes that survived (VMs outlive the agent: the unit runs
  with `Delegate=yes`, `DelegateSubgroup=agent`, `KillMode=process`) and
  settles the rest.
- One operation per computer at a time; every request is idempotent.
- Exec: a WebSocket per program, bridged to the guest agent
  (`services/firecracker_guest_agent`, root, vsock port 1024) with the frames of
  `firecracker_host_api::exec`. A `CONNECT` handshake on the jail's
  hybrid vsock socket first gets 3 s (doubled after each timeout, which
  warns) and is retried (pauses of 10 ms doubling to 100 ms) until the
  caller's deadline; `firecracker_host.vsock_connect` records the attempts
  and the last error, `firecracker_host.guest_exec` the connect time and
  exit code.
  The host agent sends its trace id with each exec (on the WebSocket path,
  when the start frame has room for it), and the guest agent logs it on the
  exec's journal lines ("exec started", "exec ended").
- Goldens are scanned for secrets before they are published: every customer
  can read a golden's whole memory.
- Spans for every phase (`firecracker_host.*`), joined to the control
  plane's trace through `traceparent`.

## Hosts

`nix/hosts/_nixos/firecracker-host.nix` declares a host: pinned Firecracker
and jailer, the agent unit, TLS as root-only credentials, host nftables. Its
NixOS test is `checks.firecracker-host`.

With `macro.firecrackerHost.alloy.enable`, Grafana Alloy on the host
(`firecracker-host.alloy`) reads host metrics (CPU, memory, pressure, swap,
KSM) and each computer's CPU, memory and disk IO from its VM's cgroup
(`<unit>/vms/c-<id>`, labelled `computer_id`), and writes them every 30 s to
Macro's Mimir in the observability cluster (`infra/k8s/observability`), where the **Macro
computers fleet** dashboard shows capacity, noisy neighbours and overcommit
in use. Nothing runs in guests. The Datadog agent stays for the agent's
spans, its `firecracker_host.*` metrics and the monitors.
