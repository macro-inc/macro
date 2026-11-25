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
  An existing computer keeps its image until an operator's rolling upgrade
  moves it: the **Firecracker image rollout** workflow (dev only for now;
  inputs: the immutable version, the `main` commit it is built from, the
  computer ids, batch size, idle wait and reconnect timeout). It builds
  `.#macro-box-firecracker`, publishes the files with their SHA-256 to the Nix
  cache bucket, and records the upgrade from the in-VPC migrator runner. The
  harness's upgrade pass stages the image on each host (checked by hash),
  then gives each idle computer (no agent turn under way or queued, no screen
  open; terminal shells are not seen) a fresh
  system disk of it with its own `/home` and identity, a batch at a time. A
  failed boot, or no macrod within the timeout, rolls that computer back to
  its previous system disk and pauses the upgrade; a host that refuses, or
  fails before the computer left its own disk, leaves it there (failed) and
  pauses it too. A computer still busy at the idle deadline is skipped, never
  forced. Hibernated computers are skipped. Two hours after the idle
  deadline whatever is unfinished stops: waiting computers are skipped, and
  one still mid-upgrade is logged for an operator.
- **The image supplies the baseline runtime**: an agent teammate starts
  with the image's `macro-agent-runtime`. An eligible dev teammate can
  select a service-only bundle as described below. A harness deploy updates
  the starter seeded for new agents; existing behavior code changes through
  the agent's own land.
- **What persists**: the system disk is replaced on upgrade. `/home`, macrod and
  harnessd state and docker data live on the state disk and survive; `/etc`,
  `/root` and anything added to `/nix` do not (there is no `/nix` overlay yet).
- **Service rollback**: a new `computer_timer_kind` or `Failure` value (such
  as `agent_redeliver` or `AgentUnsupported`) can't be decoded by an older
  service. Roll forward instead of back past one, or first clear the rows
  that hold it: the due timers of the new kind, and the computers that
  failed with the new failure.
- **Rollback**: unpublish the bad image (no new purchases), then run a rolling
  upgrade back to the previous version (one the workflow published): each computer gets its previous system
  disk itself back (it is kept until the next upgrade). Nothing deletes
  goldens or images on a host yet.

### Service-only runtime updates in dev

Dispatch **Agent runtime rollout** from `main` with `environment=dev`, one
computer ID and a full commit SHA on `main`. The workflow publishes the
`macro-agent-runtime` built with that commit's pinned Bun lock. Its version
is the commit SHA. The immutable manifest records the archive SHA-256, the
Muppet API level and the package versions. The in-VPC runner submits the
request to dev Postgres, and the harness controller runs the fixed updater
on the selected Firecracker guest. Wait for the migration and every dev
controller replica's deployment before dispatching. An unfinished request
holds that computer against image upgrades and moves. Fleet reconcile and
power effects consult the hold before starting work.

The guest image must include the updater, and the live behavior must provide
the Muppet maintenance and readiness contract. The updater refuses an
inactive, crash-looping or unreceipted baseline, including an old starter
that has never reported readiness for this invocation. Repair the baseline's
chat startup before requesting an update. The updater checks the live HEAD,
last-good, Muppet API and direct dependency fields against the bundle and
the image rollback runtime. The bundle changes only the selected runtime
and the target of the workspace's `node_modules` symlink. The workspace
keeps its own Bun lock.

The dispatcher continues work already admitted while fencing new wakes. Chat
replays queued input from its persisted cursor and inbox. A firing left
pending in a maintenance handoff replays for the same scheduled occurrence.
A live drain waits for admitted schedule handlers and their persisted completion.
If a completion write fails, the invocation cannot acknowledge a drain. An
unplanned interruption before acknowledgement can redeliver the occurrence.
Ordinary restarts keep the scheduler's existing policy. A timeout releases the fence on the same process.
Unknown event sources make an invocation ineligible for a drain.

After switching the pointer, the updater restarts `macro-agent.service` and
waits for a receipt for the new systemd invocation, exact behavior revision
and requested version/digest. That receipt uses the normal `markHealthy`
check, which requires an open `macro.events.listen` stream and a successful
`macro.users.me` round trip. The updater releases queued work after the
receipt, or restores and checks the prior runtime. These receipts depend on the
selected behavior cooperating. The agent's UID can forge a receipt for its
own guest. Recovery releases a stranded fence and retries from the journal,
including after a guest reboot. The controller confirms the guest journal
has settled before accepting a terminal result. A lost or interrupted
response retains its lease for a bounded retry. The overall deadline stops
new attempts. After three failed settlement probes past the deadline, the
controller records `needs_operator` and logs a warning. The computer stays
held against moves, power actions, reconcile and new runtime updates. Team
release is refused while a runtime update is pending or needs operator
recovery. Automatic hold clearance requires a successful upgrade to a
different approved image on a running, idle guest with macrod connected.

If the guest is ineligible for an image upgrade, use manual host recovery.
After the guest's root helper `macro-agent-runtime-update status` reports
settlement and the agent is ready, clear the exact hold in dev Postgres.
Set the `computer_id` and `request_id` psql variables to the affected UUIDs
and confirm the statement returns one row.

```sql
UPDATE agent_runtime_update
SET cleared_at = now()
WHERE id = :'request_id'::uuid
  AND computer_id = :'computer_id'::uuid
  AND outcome = 'needs_operator'
  AND cleared_at IS NULL
RETURNING id, computer_id, cleared_at;
```

Service updates leave macrod and the guest running. Cached bundles
accumulate between reboots. Automatic pruning runs only at boot when the
agent cgroup is empty, since a child can survive a service restart.

If `agent.env` changes during the candidate restart or readiness wait, the
path unit's restart helper can time out after 20 seconds waiting for the
pause/restart lock. In that case the new enrollment, credentials, or
telemetry settings take effect on the next agent service restart.

The workflow reports `applied`, `refused`, `rolled_back`,
`rollback_failed`, `expired` or `needs_operator`. Use `journalctl -u macro-agent.service -u
macro-agent-runtime-update.service -u macro-agent-runtime-recover.service`
on the guest for invocation and rollback details. For emergency recovery on
an approved dev guest, the root command
`macro-agent-runtime-update restore-image` clears the bundle selection and
restarts only the agent service. This can interrupt the unhealthy agent.
Check that the new invocation logs its startup and becomes ready before
trying another update.

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
