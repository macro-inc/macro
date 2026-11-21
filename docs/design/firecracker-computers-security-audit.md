# Firecracker computers: security audit

Status: audit of 2026-11-17; open items below. The model it checks is
[Firecracker computers: security and isolation](../architecture/firecracker-computers-security.md).

## Environment

GCP n2-standard-32 hosts with nested KVM (Intel Ice Lake), Firecracker and
jailer v1.18.0 with their default seccomp filters, guests restored from
golden snapshots: first Firecracker's CI Ubuntu image, then the macro-box
image (kernel 6.18, glibc 2.42), through the host agent. The test hosts ran
Ubuntu's GCP kernel; production hosts run the NixOS module.

## What was checked

| Area | Check | Result |
| --- | --- | --- |
| Jail | `/proc` of a jailed Firecracker: credentials, capabilities, seccomp, namespaces, cgroup, open files | Own uid/gid, no capabilities, `NoNewPrivs`, seccomp on every thread, own mount, net and pid namespaces, `memory.oom.group=1`; golden files opened read-only and mapped private |
| Jail | Uid range against the host's users | First agent build used a base of 30000: computer slot N ran as `nixbldN`. Fixed (base 1000000000, overlap refused); rechecked on a live jail |
| mTLS | No client certificate, a self-signed one, the configured one | Refused, refused (both in the handshake), accepted |
| Agent port | From guests (host address, gateway, every host-side veth) and from another host namespace | Closed |
| Network | From a guest: internet by address and name; host sshd; other VPC hosts; RFC 1918; SMTP; IPv6; spoofed source; another guest | Internet works; everything else closed |
| Network | Ping to the host's addresses | Answered at first; fixed (no echo from guests); rechecked: no reply from the host or the gateway |
| Bridge | Two VMs on one Linux bridge with a forward-hook counter | A pinged B with 0 packets counted: bridged traffic bypasses nftables (why VMs never share a bridge) |
| Metadata | Cloud metadata with its header; TCP to other ports, UDP, ICMP to 169.254.169.254 | Firecracker's MMDS answers (401); 0 packets for that address left the VMM |
| MMDS | Guest `PUT`/`PATCH`; read as root, `macro`, `nobody`, a container-style namespace; read after clearing the enrollment | Writes refused (400); root only; 404 after clearing |
| vsock | Guest to CID 1, another CID, the host without a listener | Timed out, timed out, reset |
| Leakage | A marker over 256 MiB of one clone's memory, scanned from the host in that clone, another live clone and the golden file | Millions of hits in the writer; 0 in the other clone and in the golden |
| Identity | Machine id, CRNG reseed, `/home` filesystem UUID across clones | Distinct ids, reseeded; UUID was shared by all copies, fixed (fresh UUID per copy) |
| Clone uniqueness | Two clones of one golden (`tooling/computer-bench/clone-uniqueness.py`): machine id, kernel uuid, `getrandom`, OpenSSL and Node randomness, invocation ids, DNS query ids from a resolver alive since the snapshot, journal sequence-number id | All distinct. The journal id was shared (journald's sequence state lived in the golden's tmpfs), fixed and rechecked. Same by design: the kernel boot id, invocation ids of units running at the snapshot, the D-Bus bus id |
| Guest | Serial ports, sshd and host keys, `vmx`, `/dev/kvm`, CPU vendor and RDRAND | None of the first four; `GenuineIntel` with `rdrand` |
| Golden scan | Image rootfs; the first macro-box golden | Rootfs clean; the golden was refused on a key armor line that is a library constant (false positive). The scan now needs a key body and exempts pristine-image pages; tests cover a planted key |
| Host identity | Service account and scopes; metadata from a non-root host user | Logs and metrics only. Non-root users can get its token (accepted, see the model) |
| Kernel | Host sysctls, lockdown, swap, KSM, SMT | Recorded against the model's table; the NixOS module sets them |
| Quota | Per-computer ZFS `refquota`; a guest filling its 4 GiB `/home` | Set on every computer dataset; the guest got `ENOSPC` at its volume size, its dataset grew 3.7 GiB within its 25 GiB quota, the pool lost only that. The quota (25 GiB) is below the guest's disks (32 GiB rootfs + `/home`): a guest that fills its rootfs hits the quota as an I/O error, not `ENOSPC` |

## Open items

| Id | Severity | Item | Owner | State |
| --- | --- | --- | --- | --- |
| S-2 | Medium | `io.weight` and `io.max` per VM | host agent | Open |
| S-3 | Low | `kvm-pit` thread into the VM's cgroup (found via KVM debugfs under the pid namespace) | host agent | Open |
| S-5 | High | Per-computer disk quota and a host watermark; size the quota to cover the guest's disks plus hibernation | host agent, fleet | Quota set, fill-tested and sized (rechecked: a 4 GiB-home computer gets 45 GiB = golden rootfs + `/home` + memory + 1 GiB); watermark open |
| S-6 | Medium | Core-scheduling cookie per VM | host agent | Open |
| S-10 | Medium | Per-VM network rate limit and conntrack limit | host agent | Open |
| S-12 | Low | Host sysctls in the NixOS module | provisioning | Done, verified in the NixOS test; lockdown accepted as a gap (no lockdown LSM in nixpkgs' kernel), revisit with a custom kernel |
| S-18 | Medium | Jailer, Firecracker and agent binaries from the Nix store; keys root-owned `0400` in a credentials directory | host agent NixOS module | Open: verify on a NixOS host |
| S-17 | Medium | Dev reaches the agent over public mTLS; production hosts must sit behind private networking | infra | Accepted for dev |
| S-21 | High | Warm Chromium in the golden only under the model's conditions, including the non-Intel fallback | guest image; verified by security | Implementing |
| S-23 | Low | No ICMP echo from guests to the host | host agent | Done, verified |
| S-24 | Medium | The root unit that installs an agent's environment must never follow or truncate the inbox path the `macro` user controls (a symlink there reads or truncates any file as root) | guest image | Done: inbox read and emptied as `macro`, 64 KiB cap, root writes only into root-owned `/var/lib/macrod`; NixOS test plants a symlink to `/etc/shadow` |

Done and verified: new pid namespace per jail, default seccomp, bounded
Firecracker output and no serial console in production, KSM off for VMs,
MMDS root-only in the guest, the golden secret scan, the dedicated service
account, `memory.oom.group`, the uid
range, and a fresh filesystem UUID per `/home` copy.
