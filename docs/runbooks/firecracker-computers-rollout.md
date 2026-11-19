# Firecracker computers: rollout

How Macro computers go live on Firecracker, and how the Incus infrastructure is
retired. Firecracker is the only VM backend: no customer has used computers, so
there is no cutover, no dual backend, and no data migration from Incus.

Related: [host agent](../architecture/firecracker-computers.md),
[security model](../architecture/firecracker-computers-security.md),
[Macro computers](../architecture/macro-computers.md),
[host provisioning](../guides/firecracker-host-provisioning.md),
[Firecracker runbook](firecracker-computers.md),
[capacity runbook](computer-capacity.md).

## Rules for every step

- Creating, deploying, reinstalling or deleting a host, a Pulumi stack or
  Doppler keys needs explicit approval for that action and that environment.
  An approval for dev never covers production.
- Nothing here runs against production without its own approval and window.
- Every host and cloud resource created or retired is recorded in the
  project's resource log.

## What is behind which flag

| Flag | Gates | State during rollout |
| --- | --- | --- |
| `enable-macro-computers` (PostHog, evaluated by the backend for both the web and purchases) | Settings → Computers, Buy, the computers list and its notifications | Off for everyone except the team testing a host; computers stay behind it until launch. Dev only: `COMPUTERS_ROLLOUT_ALLOWLIST` (auth + harness Doppler dev) admits listed users without it; production refuses it at startup |

There is no backend flag. The fleet is Firecracker whenever a host row exists.
A host takes purchases only while its row's `admitting` is true, so a new host
is registered with `admitting = false` and opened after it passes the checks
below.

## 1. Merge the code

The stack lands in plan order: remove Incus, multi-host computers, the
lost-first-prompt fix, the host API and pinned TLS, the host agent, the guest
image, `FirecrackerFleet`, overcommit, provisioning, host moves,
observability, the security doc, tests and bench, and the Buy UI. Merging deploys
no host: services that read computer config start with no Firecracker host
rows, and with no rows no computer can be bought.

The temporary `COMPUTERS_FLEET=incus` parser ("retired, no fleet") stays until
dev and production have dropped that value and their `COMPUTERS_INCUS_*` keys
(teardown step 5).

## 2. First dev host

1. **Provision** with the [provisioning guide](../guides/firecracker-host-provisioning.md):
   `pulumi preview` of `infra/stacks/firecracker-host`, then, with approval,
   `pulumi up`. Install NixOS with nixos-anywhere. The NixOS module pins
   OpenZFS ≥ 2.4.1, creates `tank/firecracker`, and runs the agent with the
   host's own TLS keys. The agent itself refuses to start on OpenZFS < 2.4.1
   or with `zfs_bclone_enabled` or `zfs_bclone_wait_dirty` not 1: creates
   are dataset clones, but hibernation and golden builds still use block
   cloning ([host agent](../architecture/firecracker-computers.md), **Storage**).
2. **Connect the control plane**: pin the agent's certificate in the harness
   config, then register the host row with `admitting = false` (the column
   defaults to true). The overcommit settings are per host and change without
   a deploy. Measured defaults for a 32 vCPU / 128 GiB host: 2 vCPUs and 16 GiB
   reserved, CPU ratio 600 %, RAM ratio 400 %, two sold per awake computer,
   memory watermarks 70 / 80 / 90 % (relieve, stop admitting and hibernate the
   idlest, never admit past), at most 8 concurrent restores per host.
3. **Publish a golden**: the agent builds one golden per (image, size) on the
   host. It boots the image, settles, checks it, snapshots it, and scans memory
   and rootfs for secrets. It refuses to publish on a hit. Its snapshot holds an
   empty `/home` of every size in the host limits; a size added later goes
   into every golden as a new snapshot within one upkeep pass.
4. **Verify before admitting**, on the dev host with the flag on for the test
   team only:
   - Buy → restore → macrod connected → first agent reply.
   - Exec and console; internet egress; no reach to the host, other VMs,
     private ranges or the metadata server.
   - Stop/start, hibernate/wake, delete; data on `/home`, nix profile and
     docker images survive stop/start and hibernate/wake.
   - Two purchases get distinct identities and each claims only its own
     pairing.
   - The host's spans and metrics reach Datadog under the host's name (see
     **Monitoring**).
5. **Turn on the agents worker**: set `COMPUTERS_AGENT_EFFECTS=true` in
   authentication-service's Doppler config wherever the computers rollout is
   on. Absent means off: released agent computers' `UndoAgentInvite` effects
   then wait in the outbox, and nothing takes the agent back or alerts.
6. **Open admission** (`admitting = true`) for the test team.

## 3. Production hosts

Same steps as dev, with production approval for each:

- **Shape**: bare metal when available (nested virtualization adds a
  first-touch cost to every restore and an idle CPU cost per VM). A durable
  Hyperdisk Balanced or pd-ssd for `tank`. Pin `min_cpu_platform`, so every
  host in a class has one CPU model and snapshots stay portable between them.
- **Network**: the agent listens only on the WireGuard tunnel address, never on
  a public address.
- **Identity**: the host's service account writes logs and metrics only.
  Guests never reach the metadata server.
- **Monitors**: activate the Firecracker monitors once a production host's
  telemetry flows (the monitoring stack is applied by hand, with approval).
- **Launch**: turn `enable-macro-computers` on in widening steps. Watch restore
  latency, create failures and host memory against the high watermark.

**Upgrading the host agent** (a NixOS rebuild of the host) restarts only the
agent; VMs keep running and it adopts them. The first start of an agent whose
goldens' snapshots lack an empty `/home` of a sold size (any agent upgraded
from one that cloned `/home` templates) adds them to every golden as a new
snapshot and then destroys and rebuilds every spare disk set, since a spare
names the snapshot it came from. Until the spares are back, creates
`zfs clone` the new snapshot directly (tens of ms slower, no other effect).
The agent also refuses to start on OpenZFS < 2.4.1 or with block cloning off
or unsafe; check `journalctl -u firecracker-host` before admitting again.

Hosts move later (for example to dedicated servers) with `zfs send` over
WireGuard: pre-copy while the computer runs, then a short cutover and one cold
boot on the new host ([host agent](../architecture/firecracker-computers.md), **Hosts**).
A hibernated computer's send also carries a full copy of the memory its
hibernation was cloned from (~350 MiB for an 8 GiB golden): block clones are
not shared across `zfs send`.

## 4. Images: publishing and rollback

- **Release unit**: a `macro-box` image version, fetched by each host from the
  signed Nix binary cache.
- **First image**: build the first published `macro-box` image (and the agent
  image `COMPUTERS_AGENT_IMAGE` names) from a commit that includes #11336, and
  publish it before the harness that checks the capability deploys. #11336's
  macrod is the first to declare `apply-agent` in its dial header; an agent
  computer whose macrod doesn't declare it fails at connect with
  `AgentUnsupported` and pages, and a second failure releases and refunds it.
- **Goldens are built per host**, not copied between hosts: a snapshot is tied
  to the host's CPU model, kernel and Firecracker version. Every build re-runs
  the secret scan and the golden checks. A warm-Chromium golden is refused on a
  non-Intel host, where Chromium starts after restore.
- **Who moves**: new purchases always restore the newest golden for their size.
  Existing computers move at their next stop/start, or in an operator's rolling
  upgrade, which waits for idle computers. Hibernated computers wake on their
  own image and upgrade at their next cold start.
- **The agent runtime ships in the image**: an agent teammate runs
  `packages/muppet` and its dependencies from the image's
  `macro-agent-runtime` (`nix/macro-box/_agent-runtime.nix`). A harness deploy
  changes only the starter agent it seeds into a new agent's repository, so a
  muppet change reaches agents only through a new image: release
  `packages/starter-agent` and the image together (a starter-agent `bun.lock`
  the image doesn't match fails the agent's boot).
- **What persists**: the system disk is replaced on upgrade. `/home`, macrod and
  harnessd state, docker data and the `/nix` overlay live on the state disk and
  survive.
- **Service rollback**: a new `computer_timer_kind` or `Failure` value (such
  as `agent_redeliver` or `AgentUnsupported`) can't be decoded by an older
  service. Roll forward instead of back past one, or first clear the rows
  that hold it: the due timers of the new kind, and the computers that
  failed with the new failure.
- **Rollback**: unpublish the bad image (no new purchases), then run a rolling
  upgrade back to the previous one. Each host keeps the two newest goldens per
  size, plus any golden a computer still uses. Goldens are deleted only at
  refcount 0 outside that window.

## 5. Incus teardown

Ordered and gated: each step starts only after the previous one's completion
check passes, and each one that changes infrastructure needs its own approval.

| Step | Action | Done when |
| --- | --- | --- |
| 1 | A Firecracker dev host is live with a registered row and passes the checks in **First dev host** | Hosted dev works without the Incus gateway |
| 2 | Switch hosted dev's harness config and code to Firecracker. Release leftover lab computers and reservations through their normal lifecycle while Incus is still reachable. Close the old host row to purchases | No effect or job needs Incus |
| 3 | Run hosted dev on Firecracker across a normal deploy and rollback. Retire the old dev host row only after the rows that reference it are resolved. Move local stacks off Incus | No Incus consumer is left in dev |
| 4 | Remove the obsolete dev Doppler keys | No running replica reads them |
| 5 | Remove the `COMPUTERS_FLEET=incus` compatibility parser | Dev **and** production have dropped the value and their `COMPUTERS_INCUS_*` keys |
| 6 | Destroy the dedicated `computers-dev-gateway` Pulumi stack (export its state first). Delete only its own `/32` routes; shared VPC, route tables, NAT and the harness security group stay. Then remove its source | Gateway resources gone, Firecracker still reachable |
| 7 | With dev disposal approval: delete `runtime-dev-1` and, separately, its pool disk | No dev Incus VM, disk or address remains |
| 8 | **Separate production approval and window**: confirm production Incus is unused, resolve its rows, switch its config, clean its keys (steps 2–5 for production), then delete `runtime-prod-1` and its pool disk | Production Incus retired |
| 9 | Remove the `macro-computers` VPC's firewall rules, route, subnet and network, after checking no Firecracker host uses them | No Incus network remains |
| 10 | Read-only final check of instances, disks, addresses, routes, IAM objects, config keys and host rows | Nothing Incus-specific is left |

No customer data is migrated: there is none.

## Monitoring and runbooks

- Datadog monitors: `infra/stacks/monitoring/monitors/firecracker.ts` (restore
  p95, create, hibernate and wake failures, agent health, memory above the
  high watermark, reconcile drift, golden publication failures and secret-scan
  refusals) and the **Firecracker computer alerts** dashboard.
- Recovery: [Firecracker runbook](firecracker-computers.md) (agent
  down, golden refused, out of memory, slow restores, create, hibernate and wake
  failures, drift, evacuating a host).
- Capacity and overcommit: [computer capacity](computer-capacity.md).
- Purchase traces: [computer setup traces](computer-setup-traces.md).
