# Firecracker computers: security and isolation

The threat model and isolation design of Macro computers: Firecracker microVMs
run by the host agent (`services/firecracker_host`,
`crates/firecracker_host_api`) from the `nix/macro-box` image. How computers
work is in [Macro computers](macro-computers.md) and
[Firecracker computers: the host agent](firecracker-computers.md). The checks
behind each claim, and the hardening items still open, are in the
[security audit](../design/firecracker-computers-security-audit.md).

## What we protect

| Asset | Where it lives |
| --- | --- |
| A customer's files, processes and credentials | Guest RAM, its `/home` volume, its rootfs copy |
| The enrollment device secret | One VM's MMDS, until macrod claims it |
| Other customers on the same host | Their VMs, volumes and network traffic |
| The host and the fleet | The host agent, its mTLS key, the host's cloud identity, the path to the control plane |
| Macro's internal network | VPC ranges, the tailnet, the control plane |

The attacker is a customer, or whatever controls their guest (an agent running
untrusted code, a compromised package), with root in that guest. Root in the
guest is given: a computer is the customer's machine. The host trusts nothing
in the guest.

## Layers, from the guest out

```
guest userspace (root by design)
  └─ guest kernel                          customer-controlled after boot
      └─ KVM (host kernel)                 hardware virtualization boundary
          └─ firecracker process           device emulation: virtio-net/blk/vsock/balloon, serial, MMDS
              seccomp per thread, uid/gid per VM, no capabilities, NoNewPrivs
              chroot + mount, net and pid namespaces, cgroup v2
                  └─ host (root): host agent, nftables, disks, cloud metadata
                      └─ cloud: hypervisor, VPC firewall
```

An escape has to beat KVM or Firecracker's small Rust device model, then the
seccomp filter, then a non-root uid in a chroot with no capabilities, and then
find something useful from a network namespace that only routes to the
internet.

## Jailer

Every VM runs under Firecracker's jailer with its own uid and gid, its own
chroot, mount, network and pid namespaces (`--new-pid-ns`), a cgroup under the
agent's, and `RLIMIT_NOFILE` 4096. The resulting process has no capabilities,
`NoNewPrivs`, seccomp on every thread, no core dumps, and only its own files:

- The chroot holds a copy of the `firecracker` binary, its API and vsock
  sockets, its devices (`kvm`, `net/tun`, `urandom`, `userfaultfd`), its disks
  (owned by its uid, `0600`) and the golden's `vmstate` and memory file
  (root-owned, read-only). Firecracker opens the memory file read-only and
  maps it private.
- Uids come from a reserved range (from 1000000000) that has no `/etc/passwd`
  entries and must not overlap any system range: Nix build users, for one,
  are uids 30001-30032 on NixOS. The agent refuses to start on an overlap. A
  uid is never reused while its previous chroot exists.
- The paths the jailer gets (`--exec-file`, `--chroot-base-dir`, the netns
  path) and their parents are root-owned and not writable by VM uids: the
  jailer trusts them. The jailer, Firecracker and agent binaries come from the
  Nix store; the agent's keys are root-owned `0400` in a credentials
  directory (S-18 in the audit, not yet verified on a NixOS host).
- The jailer leaves the IPC, UTS, user and cgroup namespaces shared and the
  capability bounding set full; with no capabilities, `NoNewPrivs` and no
  file capabilities in the chroot, that grants nothing.
- Each VM's cgroup sets `memory.max`, `memory.oom.group=1` (an OOM kill ends
  one whole VM), `cpu.max` and `pids.max`. Still open (S-2, S-3 in the
  audit): `io.weight` and `io.max` to bound its disk I/O, and moving the
  `kvm-pit` kernel thread KVM creates for each VM into that cgroup
  (Firecracker's `prod-host-setup.md`). Under a pid namespace that thread is
  named `kvm-pit/1`, so the agent finds it through KVM's debugfs entry for
  the host pid.

## Seccomp

Firecracker's default filters are built in
(`resources/seccomp/x86_64-unknown-linux-musl.json`); never pass
`--no-seccomp` or a custom `--seccomp-filter`. The default action is `trap`
(SIGSYS: the process dies). Per thread, as of v1.18.0:

| Thread | Syscalls allowed |
| --- | --- |
| vmm | `accept4 brk clock_gettime close connect epoll_ctl epoll_pwait eventfd2 exit exit_group fallocate fcntl fstat fsync ftruncate futex getrandom gettid io_uring_enter io_uring_register io_uring_setup ioctl lseek madvise memfd_create mincore mmap mprotect mremap msync munmap open read readv recvfrom recvmsg restart_syscall rt_sigaction rt_sigprocmask rt_sigreturn sched_yield sendmsg sendto sigaltstack socket stat timerfd_create timerfd_settime tkill write writev` |
| api | `accept4 brk clock_gettime close epoll_ctl epoll_pwait exit exit_group fcntl fstat futex getrandom gettid ioctl madvise mmap mremap munmap open read recvfrom recvmsg restart_syscall rt_sigaction rt_sigprocmask rt_sigreturn sched_yield sendto sigaltstack socket tkill write` |
| vcpu | `brk clock_gettime close epoll_ctl eventfd2 exit exit_group fstat futex gettid io_uring_enter ioctl madvise mmap mremap munmap open restart_syscall rt_sigaction rt_sigprocmask rt_sigreturn sched_yield sendmsg sigaltstack timerfd_settime tkill write` |

Many rules filter arguments: `ioctl` only for the KVM, TUN and block requests
Firecracker uses; `socket` only `AF_UNIX` stream (the vsock socket); `mmap`
and `mprotect` never with `PROT_EXEC`; `tkill` only for a panic's `SIGABRT`
and the vCPU kick. There is no `execve`, `clone`, `fork`, `ptrace`, `bpf`,
`mount`, `unshare`, `setns`, `kexec` or inet socket. The weak point is
`io_uring_*`, allowed for the async block engine: io_uring has had kernel
privilege escalations. We use the sync engine, keep the host kernel current
and set `kernel.io_uring_disabled=2`.

## Host agent

The agent runs as root: the jailer needs root to chroot, change uid and create
namespaces and cgroups, and the agent manages network namespaces, veths,
nftables, disk clones and quotas.

| Surface | Who reaches it | Rule |
| --- | --- | --- |
| REST API over mTLS | The control plane only | One listen address, never a wildcard; client and server certificates pinned both ways; nftables admits the port only from the control plane's address; the cloud firewall is the outer wall. Production hosts sit behind private networking. |
| Firecracker API sockets | The agent | Every call has a timeout and parses defensively: a compromised Firecracker can stop answering or answer garbage. |
| Guest vsock (exec, readiness) | The agent dials guest port 1024 | The guest agent is customer-controlled after restore: its frames are untrusted input (1 MiB limit, timeouts, nothing interpreted beyond the frame protocol). |
| Guest-initiated vsock | The guest connecting to CID 2 | Firecracker maps a guest's `connect(2, port)` to the host socket `<v.sock>_<port>`; the agent never listens on one, so the guest is reset. |
| Exec | Control plane → agent → guest | Runs in the guest as any uid; never on the host. |
| Files in chroots | VM uids own their chroot | The agent never follows a symlink a VM uid could plant: it opens relative to the chroot and deletes with a no-follow walk. |

The host's cloud identity is a dedicated service account that can only write
logs and metrics; anything else the agent needs comes from the control plane
over mTLS. The agent and the NixOS module filter only the computers'
interfaces and the agent's port, never the host's own output: closing the
metadata server to non-root host users also closes the cloud resolver at the
same address, which unprivileged resolvers forward to. Any host process can
therefore get the logs-and-metrics token, which is accepted. Jailed Firecracker
processes cannot: their traffic leaves through their veth, where link-local
addresses are dropped.

## Network

Every VM has its own network namespace: the guest's `tap0` (the guest is
172.16.0.2 behind it, with the golden's MAC) and one end of a veth whose other
end is in the host namespace with its own /30. Traffic leaves through NAT.

- Inside the namespace: forward only from `tap0` with source 172.16.0.2
  (anti-spoofing) and established replies back; input dropped except loopback
  and established traffic; masquerade out.
- On the host: input from guest veths is dropped except established traffic
  and the ICMP errors path MTU discovery needs (no echo: guests cannot ping
  the host). Forward from guest veths drops IPv6, other guests, the tunnel and
  tailnet interfaces, private, CGNAT, link-local, loopback, multicast and
  reserved ranges, and SMTP (tcp/25). Everything else, the internet, is
  allowed.
- Private destinations a deployment needs (its control-plane endpoints) are
  the agent's `network.guest_destinations`: each one IPv4 address and one TCP
  port, accepted ahead of the private-range drop, with no ranges.
- Guests resolve through public resolvers handed to them in MMDS; nothing on
  the host serves them.
- Never put VMs on a shared Linux bridge: frames between two VMs on one bridge
  are switched at layer 2 and never reach the nftables forward hook. Every VM
  is its own layer-3 hop, and the host drops guest-to-guest forwarding as a
  second wall.
- Each VM's network is to be rate limited (Firecracker's `rx_rate_limiter`
  and `tx_rate_limiter`, or `tc` on its veth) with a conntrack limit, so one
  guest cannot saturate the NIC or the conntrack table (open: S-10).

## MMDS and the enrollment secret

MMDS is answered inside the Firecracker process from data the agent puts on
the API socket. It is not in the snapshot (only its configuration is). Every
frame the guest sends to 169.254.169.254 is consumed by it, so nothing for that
address leaves the VMM and the guest never reaches the cloud's metadata
server; the host drops link-local destinations anyway. The guest cannot write
MMDS.

MMDS holds `macro.identity` (computer id, host time, network, role) and, until
macrod claims it, `macro.enrollment`: the enrollment JSON with the one-time
device secret. The agent deletes the enrollment once the control plane sees
macrod connect, and the pairing is single-use, so a secret read after the claim
claims nothing. MMDS is a network service with no permissions of its own, so
the guest image closes it to everyone but root: its firewall rejects output to
169.254.169.254 from any uid but 0 and drops forwarded traffic (containers) to
it. Unprivileged code and the agent sandbox (`macro-agent`) never see it.

## Guest roles

A computer is a person's or an agent's (`identity.role` in MMDS, written by
the host). `macro-restore` applies it as root: a person's computer gives
`macro` sudo and the Docker socket; an agent's computer gives neither and
runs the agent in its sandbox. Root units on an agent's computer that act on
files the `macro` user can write (such as the inbox macrod stages the agent's
environment in) read and truncate them only as `macro`, never as root, and
never follow a symlink there.

## vsock

Firecracker's vsock is its own device, bridged to a Unix socket in the chroot,
not the host kernel's `vhost_vsock`. Every VM can use the same guest CID; there
is no path from one VM's vsock to another's. The guest agent on port 1024 runs
as root in the guest and runs what the host asks; only the agent (root) and
the VM's own uid can open the host side.

## Snapshots and shared memory

Every computer is a restore of one golden snapshot per image and shape:
`vmstate` plus a memory file that every clone maps private.

- **Nothing leaks between clones through the memory file.** A page a guest
  writes becomes its own anonymous copy; the kernel never writes a private
  mapping back to the file.
- **Every customer can read the whole golden's memory.** Pages a guest frees
  and the balloon reports are dropped, and the next read returns the golden's
  page, not zeros. So nothing secret may be in the golden.
- **The golden boot is unenrolled.** MMDS has no identity or enrollment;
  macrod, harnessd and everything that needs `/home` start only after restore.
  The image has no sshd and no host keys.
- **The golden pipeline refuses secrets.** Before publishing a golden, the
  agent scans its memory, its booted rootfs and the `/home` template for
  private keys (the armor line followed by a real key body, e.g.
  `b3BlbnNzaC1rZXktdjE` for OpenSSH or `MII` for PEM) and tokens. A match is
  exempt only if the same page appears in the pristine image, which is public
  by definition (it ships nixpkgs test keys and library constants holding the
  armor line). A refused golden is kept, root-only, so the hit can be
  classified.
- **Randomness.** VMGenID makes the guest kernel reseed its CRNG on every
  restore, and the vDSO `getrandom` follows the VM generation. Userspace state
  copied from the golden is not reseeded: a process alive at snapshot time
  hands the same pre-drawn values to every clone. `macro-restore` gives every
  identity its own machine id.
- **Warm processes in the golden.** BoringSSL (Chromium's TLS and WebCrypto)
  detects `fork()`, not VM clones, and keeps a DRBG per thread. On an Intel CPU
  with RDRAND it mixes fresh RDRAND bytes into every generate call, so clones
  diverge at once; on other CPUs it mixes zeros, and every thread of a warm
  process repeats the same bytes in every clone until its 4096-call reseed.
  Values drawn before the snapshot (TLS sessions and tickets, profile keys,
  install ids) are the same in every clone on any CPU. A golden keeps Chromium
  warm only when: the pipeline sees `GenuineIntel` and `rdrand` in the golden
  guest (otherwise Chromium starts after restore); Chromium's network service
  and every renderer and utility process are killed and respawn after each
  restore and each wake into a new identity; the golden's Chromium makes no
  network request and creates no secret before the snapshot (fresh profile on
  `about:blank`; no keyring or Safe Storage key; component updater,
  variations, Safe Browsing and push messaging off until after restore); and
  Node, macrod and harnessd start only after restore.
- **Node and Claude are warmed, not kept.** Node seeds OpenSSL's DRBG, V8's
  `Math.random` and its `randomUUID` cache at startup and cannot reseed them,
  so no Node or Claude process crosses the snapshot. The golden boot instead
  runs one warm-up turn against a loopback stand-in model with no network,
  no credentials, a private `/tmp` and a scratch home, and keeps only its
  results: page cache and a V8 compile cache on the rootfs. The pipeline
  refuses to snapshot while any warm-up process is alive, and `/etc/skel`
  gains only first-run settings with no per-install ids.
- **The `/home` template is shared customer storage.** Every new computer's
  `/home` starts as a clone of one template per size. The template holds no
  keyring, Safe Storage or `os_crypt` material, Chromium install or client ids,
  push-messaging store, NSS key database, GnuPG `random_seed`, SSH or Docker
  credentials, PulseAudio cookie, VNC password, `.Xauthority`, or Claude,
  harnessd, macrod, npm, gh or git credentials, unless `macro-restore`
  regenerates them before first use. The template is root-owned and read-only
  outside every chroot, and each copy gets a fresh filesystem UUID.
- **Per-computer state on disk.** Hibernation writes a VM's memory and state
  into its own storage, owned by its uid, deleted with the computer. Hosts run
  without swap, so guest memory never lands on a shared swap device.

### Side channels from sharing

- **Shared golden pages.** Clones share the golden's physical pages until they
  write them. A co-resident customer can time accesses to shared pages
  (Flush+Reload) and learn which golden code another clone runs; it learns
  nothing about data a clone wrote. The risk is to non-constant-time crypto in
  golden binaries; Rust (`ring`, `rustls`), OpenSSL 3 and Go are constant time
  for what macrod and git use. Accepted. It is a deliberate exception: the
  jailer copies the Firecracker binary into each chroot so VMs share no
  Firecracker code pages; only guest memory from the golden is shared.
- **KSM stays off for VMs.** KSM's copy-on-write fault after a merge is a
  timing oracle for "another VM holds this exact page", and it cannot be
  limited to golden pages: any mergeable page merges with any other. The
  private golden mapping already shares what idle clones have in common; what
  KSM would add is pages that became identical after customers wrote them,
  the ones whose sharing reveals another customer's data. VM memory is never
  marked mergeable; free memory returns through balloon free page reporting.

## Side channels from the CPU

- **SMT.** vCPU threads of two customers on sibling hyperthreads share caches,
  fill buffers and ports. Disabling SMT halves capacity; instead every VM is to
  get its own core-scheduling cookie (`PR_SCHED_CORE`), so the scheduler never
  runs two VMs on one core at once (open: S-6).
- **Nested virtualization.** On cloud VMs with nested KVM, our VMs are L2. The
  cloud does not share a physical core between two of its VMs, so other cloud
  tenants are not our siblings; our own VMs are. Nested virtualization is not
  passed to guests (no `vmx`, no `/dev/kvm`).
- **Guest kernel mitigations** are the guest's own business: they protect the
  customer's kernel from the customer's processes. KVM's mitigations on VM exit
  protect the host.

## Denial of service

| Vector | Mitigation |
| --- | --- |
| CPU | `cpu.max` per VM from the sold vCPUs; the fleet's CPU allocation ratio; `kvm-pit` in the VM's cgroup |
| Memory | `memory.max` per VM; admission on resident memory (the fleet's watermarks); balloon `deflate_on_oom`; a host reserve for the agent; `memory.oom.group` so the OOM killer ends one VM, never the agent |
| Disk space | A per-computer quota (ZFS `refquota` on its dataset) and a host watermark that stops admitting (watermark open: S-5) |
| Disk I/O | `io.weight` and `io.max` per VM; Firecracker's block rate limiter (open: S-2) |
| Network | Per-VM rate limits and a conntrack limit (open: S-10) |
| Serial console and logs | Production guests boot with `8250.nr_uarts=0`; Firecracker's stdio goes to `/dev/null` and its log, at `Warn`, to bounded storage |
| Thundering-herd wake | Concurrent restores fault the same golden pages; the agent admits restores through a bounded queue and the fleet staggers wakes |
| Hung Firecracker | Its signal handlers are not async-signal-safe; the agent watches API liveness and kills a wedged VM by pid |
| Control-plane API flood | mTLS and the address allowlist limit callers; the agent bounds concurrent creates |

## Host kernel hardening

The NixOS module sets (checked by its NixOS test):

| Setting | Value |
| --- | --- |
| `kernel.unprivileged_bpf_disabled` | 1 or 2 |
| `vm.unprivileged_userfaultfd` | 0 (the jailer hands Firecracker `/dev/userfaultfd`) |
| `kernel.kptr_restrict`, `kernel.dmesg_restrict` | 1 or more, 1 |
| `kernel.yama.ptrace_scope` | 2 |
| `kernel.perf_event_paranoid` | 3 or more |
| `kernel.io_uring_disabled` | 2 |
| `kernel.kexec_load_disabled` | 1 |
| `kernel.unprivileged_userns_clone` | 0 |
| Lockdown | none: nixpkgs' kernel has no lockdown LSM. Accepted: VMs run jailed at uids from 1000000000 with no capabilities, under the rest of this table. Revisit with a custom host kernel |
| Swap | none |
| SMT | on, with core scheduling per VM |
| `CONFIG_INIT_ON_ALLOC_DEFAULT_ON` | y: pages are zeroed before reuse |
| Kernel command line | `quiet loglevel=1` (console logging slows restores) |

Keep the host kernel and Firecracker current: Firecracker ships security
fixes as patch releases, and KVM is the main boundary.

## Escape threat model

| Step | Attacker needs | Walls | Detection |
| --- | --- | --- | --- |
| 1. Guest userspace → guest kernel | Root in the guest | None: root is given | n/a |
| 2. Guest kernel → Firecracker | A bug in a virtio device, MMDS, serial, vsock, the balloon or snapshot state | Small Rust device model; no PCI, USB, graphics or firmware; fuzzed upstream | Firecracker dies on a seccomp trap; the agent reports unexpected VM exits |
| 2'. Guest kernel → host kernel | A KVM bug | A current host kernel; no nested virtualization for guests | Host oops (`panic_on_oops=1`) |
| 3. Firecracker → out of the jail | Code execution in the process | Seccomp (no exec, inet sockets or namespaces), a uid with no capabilities, a chroot, its own namespaces | Seccomp kills in the host audit log |
| 4. Jail → host root | A kernel bug reachable through the allowed syscalls (KVM and TUN `ioctl`, `mmap`, io_uring) | The kernel hardening above | — |
| 5. Host root → fleet | The agent's mTLS key, the host's cloud identity | A logs-and-metrics-only service account; the agent's API answers only the control plane | Cloud audit logs |
| Lateral: another VM on the host | Steps 2-4, or a network path | No shared bridge, a uid and chroot per VM, nftables drops | nftables counters on guest-to-guest drops |

Step 2 is why Firecracker: a guest faces far less emulated hardware than under
QEMU, and the VMM runs under a tighter per-thread filter.
