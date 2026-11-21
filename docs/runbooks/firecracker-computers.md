# Firecracker computers

The **Firecracker computer alerts** Datadog dashboard is linked from each alert.
Monitors are defined in `infra/stacks/monitoring/monitors/firecracker.ts`.
They cover production hosts only; the monitoring stack is manual. Creating a
monitor definition does not deploy it or install its telemetry producer.

Production inspection and intervention require explicit authorization for the
affected environment. The diagnostic and recovery commands below are for an
approved operator session; this document does not grant production access.

## Telemetry contract and activation

Install the host and fleet instrumentation before activating these monitors.
Each host's local Datadog agent must accept OTLP on port 4317 and use the same
hostname as the host agent's `host_name` and the fleet registration. The host unit supplies
`host.name` through `OTEL_RESOURCE_ATTRIBUTES`; the local collector uses the
same hostname for Datadog's `host` tag. A mismatched name separates host health from admission memory reports.
The service must export as `service:firecracker-host` with the correct `env`.

| Signal | Source | Initial alert |
| --- | --- | --- |
| Restore duration | `macro.firecracker.restore.duration`, span-derived distribution, nanoseconds | p95 above 1 s warning, 2 s critical, averaged over 10 minutes, per host and source |
| Create failures | `firecracker_host.operation.failures`, `operation:create`, excluding `error_code:golden_not_ready` | 1 warning, 3 critical attempts in 10 minutes |
| Agent unhealthy | `firecracker_host.ready`, 0/1 each minute | No healthy sample for 2 minutes; missing data after 5 minutes |
| Golden publication failure | `firecracker_host.golden.builds`, `outcome:failed` | Any in 10 minutes |
| Golden secret refusal | Same counter, `outcome:secret_refused` | Any in 10 minutes |
| Memory pressure | `computer.host.memory.used_ratio / computer.host.memory.high_watermark_ratio` | Average above 1 for 5 minutes |
| Hibernate / wake failures | `firecracker_host.operation.failures`, `operation:hibernate` or `operation:wake` | 1 warning, 3 critical attempts in 10 minutes |
| Unresolved drift | `firecracker_host.reconcile.drift` | Above zero throughout 5 minutes |

Agent health, memory pressure and secret refusals page. Other monitors notify
through GoAlert without paging. Thresholds are initial rollout guardrails, not
measured production service objectives; revisit after collecting a baseline.
Counters count failed attempts, so retries can represent one affected computer.
Failures recover when the rolling count falls below threshold; this does not
prove a successful operation. Sparse success traffic can leave p95 empty.

The restore metric is computed from all ingested successful
`firecracker_host.launch` spans with `source:golden` or `source:hibernation`;
percentiles are enabled explicitly. The stable snake_case source values come
from the host's `BootSource` Display implementation. Cold boots and failed
launches are excluded.
It measures preparation through vCPU resume, excluding admission queue wait,
guest restore, enrollment and macrod connection. Use the full trace to establish
when the computer became usable. Metrics start accumulating when their
definitions are deployed and do not backfill prior spans.

Before activation, verify a known host reports fresh readiness and memory
gauges under the same `host`, and exercise create, hibernate/wake and a refused
golden on an isolated test host. Confirm error counters and drift return to
normal after repair. Check an end-to-end trace is connected from the fleet HTTP
client through the host phases; metric graphs alone do not prove propagation.
Missing data on event counters or p95 is normal when idle. The readiness monitor
alerts when a previously seen host disappears; it cannot discover a host that
has never exported. Validate new hosts before admitting purchases. During
approved host retirement, mute that host's health group through the retirement
window, then verify the group has aged out.

## Host agent down

1. Scope the incident by `host` and `env`. Compare
   `computer.firecracker.reachable` from the control plane with host readiness.
   A host that runs guests may still have a dead agent or collector. Ask the
   fleet operator to set the host's `admitting` field false using the approved
   host administration path; verify new purchases stop selecting it. Do not
   change backend identity or delete its registration.
2. On the affected host, inspect service state and bounded logs:

   ```sh
   systemctl status firecracker-host.service datadog-agent.service
   journalctl -u firecracker-host.service --since '-15 minutes' --no-pager
   journalctl -k --since '-15 minutes' --no-pager
   ```

   Check storage availability, cgroup memory, certificate validity and the
   collector's OTLP listener. Distinguish failed mTLS, an unreachable agent and
   missing telemetry before changing credentials.
3. Use an existing mTLS endpoint file on the operator machine. It contains
   `url`, `client_certificate`, `client_key` and `server_certificate` paths;
   keep keys out of shell arguments and incident messages:

   ```sh
   firecracker-host client --endpoint <endpoint.toml> host
   firecracker-host client --endpoint <endpoint.toml> list
   firecracker-host client --endpoint <endpoint.toml> get <computer-id>
   ```

4. After identifying the cause and obtaining approval for the intervention,
   repair it and restart only `firecracker-host.service` if necessary. The
   supported unit uses `KillMode=process`; its jailed VMs outlive the agent and
   startup reconciliation adopts them. Verify that unit setting before a
   restart. Never reboot the host as the first recovery step.
5. Verify readiness is 1, inventory matches the durable records, drift is zero
   and existing computers reconnect. Reopen admission only after checking live
   capacity. A green health monitor alone does not prove guest readiness.

## Golden refused

1. Keep the refused golden unpublished and the affected image out of new
   purchases. Leave already running computers alone. List goldens through the
   mTLS client and locate the failed image and shape's build trace:

   ```sh
   firecracker-host client --endpoint <endpoint.toml> goldens
   ```

2. For `outcome:secret_refused`, treat the artifact as restricted evidence.
   Record only image digest, shape, scan classification and opaque trace ID in
   the incident. Do not upload snapshot memory, enrollment documents, private
   keys, matched bytes or durable records to logs or tickets. Assess exposure
   and rotate implicated credentials through the security response process.
3. Trace `golden_build_queue`, `golden_build`, `golden_secret_scan`,
   `golden_seal` and `golden_publish`. For ordinary publication failure, check
   free space, permissions and filesystem health. For a scan refusal, rebuild
   from the reviewed, unenrolled image after removing the credential source.
   Never bypass the scan, copy a ready marker or reuse an enrolled snapshot.
4. Once the source issue is fixed, request the intended shape's build:

   ```sh
   firecracker-host client --endpoint <endpoint.toml> build-golden --image <image> --vcpus <count> --memory-mib <mib>
   ```

5. Verify the requested golden becomes ready, publication succeeds and a test
   clone enrolls with a fresh identity. A ready golden with the same key is
   reused; changing an image requires its new versioned key. Restore purchase
   eligibility only after these checks.

## Host out of memory

1. Close admission for the affected host through the fleet operator and check
   `computer.host.memory.report_age`. Compare the live report with
   host `MemAvailable`, `memory.total`, and `memory.guest_resident`; unknown or
   stale reports are not spare capacity. Inspect kernel OOM events with the
   bounded journal command above.
2. The alert compares live usage to the host's configured high watermark.
   `memory.peak` is a historical maximum and must not be used as the policy
   threshold. Check the low/high watermarks, hard ceiling and reserved memory
   before altering policy. Do not raise the ceiling to make the alert green.
3. Check that admission refuses more work and the overcommit controller
   hibernates eligible idle computers. Review
   `computer.overcommit.refusals` and `computer.overcommit.hibernations`, launch
   queue depth, storage free space and snapshot errors. An oversized wake burst
   can consume headroom before idle hibernation finishes.
4. If automatic relief cannot proceed, coordinate an approved interruption
   of a specific idle computer and use the supported lifecycle operation:

   ```sh
   firecracker-host client --endpoint <endpoint.toml> hibernate <computer-id>
   ```

   Verify its saved state is durable and the process exits before counting
   memory as reclaimed. Do not kill arbitrary guests, delete snapshots or
   perform pool-wide cleanup. If the host OOM-killed a VM, preserve its disks
   and inspect reconciliation before an approved restart; lost RAM cannot be
   recovered from the disk alone.
5. Keep admission closed until usage is below the configured low watermark,
   the report is fresh and drift is zero. Arrange evacuation or additional
   capacity through the infrastructure operator when pressure persists.

## Restore latency

Find `firecracker_fleet.create` or `firecracker_fleet.start` by opaque
`computer_id`, then its host request and `firecracker_host.launch` child.
Compare golden and hibernation sources separately. Inspect disk preparation,
`launch_queue`, `jail_prepare`, `jailer_spawn`, `snapshot_load`, `drives_patch`,
`mmds_put`, `resume`, `guest_connect` and `guest_restore`. Queueing points to
bounded launch concurrency or pressure; snapshot load and disk phases point to
storage, cold page cache or incompatible artifacts. Check CPU pressure and
concurrent golden builds before tuning concurrency. After repair, verify guest
connection and first useful work as well as the restore percentile.

## Create failures

Split `firecracker_host.operation.failures` by `error_code` on the affected host.
`golden_not_ready` is excluded from this alert because a missing golden triggers
an asynchronous build. Follow the golden procedure if builds repeatedly fail.
For `guest_unreachable`, check vsock and guest restore; for `no_network_slot`,
check inventory and admission; for `internal`, inspect storage, jailer and
network phases. Generation mismatches require checking the existing ownership,
not deleting the computer. Retry the existing computer through the control
plane after fixing the cause; creation is idempotent and a failed attempt may
already have durable disks and a stopped record. Do not create a replacement
identity or release a paid reservation solely to clear an alert.

## Hibernate and wake failures

Use `computer_id` to join the fleet and host traces. For hibernation inspect
snapshot creation, available storage and durable publication. For wake inspect
`source:hibernation`, snapshot compatibility, restored drives and guest
connectivity. Preserve rootfs, home, memory and vmstate together. Do not restore
a used computer from the unenrolled golden or delete saved RAM as an automatic
fallback: either can lose session state, and golden memory belongs to its own
fresh rootfs. Escalate any cold restart that discards RAM for explicit approval.
After repair, retry the supported start operation for the same identity and
verify guest connection and persisted files:

```sh
firecracker-host client --endpoint <endpoint.toml> start <computer-id>
```

## Reconcile drift

Compare `firecracker_host.reconcile.drift` with
`firecracker_host.reconcile.actions` by `action`. Actions count repaired drift;
the alert counts unresolved objects/errors. Locate the latest reconciliation
trace and correlate durable records with actual jailed process IDs, cgroups,
network slots, storage and hibernation state. Preserve the affected objects
until ownership is established. Never remove a jail or volume just because
one inventory request omitted it. Use approved repair for the specific object,
then verify a full reconciliation pass reports zero unresolved drift and
existing computers remain reachable.

## Evacuate a host

Use the move API in `agent_harness_service` after the move implementation,
database migration and host move listeners are deployed in the approved
environment. There is no bulk drain endpoint: move computers individually and
verify each result before proceeding. Do not edit `host_id` directly or copy
files around the move operation.

1. Close source admission through the approved host administration path.
   Inventory every computer and reservation, destination capacity, images and
   disk usage. Both hosts must belong to the same control plane, use the
   supported ZFS storage and expose their agents' `[moves]` listener over
   the private WireGuard mesh. Provision this through
   `macro.firecrackerHost.moves`; use MTU 1380 on GCP paths. Confirm the
   target's reported `moveAddress` is reachable before moving data.
2. Obtain approval for a cold restart and choose an interruption window. The
   current tool moves rootfs, home and enrollment identity, **not RAM**: it
   discards hibernation and cold boots even between compatible hosts. Live
   processes and agent sessions end. It does not wait for macrod idleness or
   park prompts during cutover, so avoid active work and new prompts until
   verification completes. Keep both hosts available throughout the operation.
3. With the approved internal API client, send this request to the control
   plane driving both hosts. Authentication requires its
   `x-internal-auth-key` header; load the credential from the approved secret
   source rather than pasting it into shell history or an incident report.

   ```http
   POST /internal/computers/<computer-id>/move
   Content-Type: application/json

   {"toHost":"<destination-host-id>"}
   ```

   HTTP 201 returns the move record, not a completed migration. HTTP 409
   refuses a same-host move, an already moving or still provisioning computer,
   a target without a move listener, or insufficient capacity. HTTP 404
   means the computer was not found; storage unavailability returns 503, and
   other request failures return 500 and are logged as errors. Read the
   refusal, check the current move history, and fix the prerequisite
   before retrying; do not launch a second move to clear an error.
4. Read progress through the same authenticated client:

   ```http
   GET /internal/computers/<computer-id>/moves
   ```

   The response lists moves newest first and omits move tickets. Track
   the specific returned move ID, `stage`, `rounds`, `lastRoundBytes` and
   `error`. The operator advances work every five seconds. Failed steps keep
   their latest `error` and retry indefinitely on later passes; release is
   the terminal give-up condition. The same error across repeated reads
   indicates stalled progress requiring diagnosis, not manual guest startup.

   | Stage | Meaning and check |
   | --- | --- |
   | `seeding` | Copies while the guest runs; cuts over when a round is at most 128 MiB or after 12 rounds. Check copy progress and free storage. |
   | `cutting_over` | Stops/releases the source, sends the final incremental, adopts at the destination and atomically changes host ownership. Source fencing prevents two writers; the control plane holds conflicting effects and reconciliation. |
   | `verifying` | Waits for macrod to connect as the same running computer on the destination. A previously stopped computer commits without this connection check. |
   | `committed` | The move succeeded and the source's staged copy has been dropped. Confirm the computer's host, connectivity and persisted files before moving another computer. |
   | `rolling_back` | Destination verification exceeded two minutes after the host flip. The operator runs release/copy/adopt in reverse, including changes written on the destination. Keep both hosts and storage available. |
   | `rolled_back` | Ownership returned to the source. Verify connectivity and persisted data there, then diagnose the destination before retrying. |
   | `failed` | The computer was released during the move. Check the release lifecycle and cleanup rather than recreating the computer. |

5. Follow the move trace and each host's replication, release and adopt phases.
   Check shutdown was clean and the final disks durable; a forced stop gives
   only crash consistency. Verify the same identity reconnects and inspect
   representative persisted files. Check both hosts' readiness, unresolved
   drift and fresh memory reports. The two-minute verification is a macrod
   connection check, not a file-integrity or application-health guarantee.
   The source copy is removed automatically on commit; there is no extra
   operator-verification retention window. Preserve any separately approved
   backup before starting when that recovery window is required.
6. If progress or rollback stalls, keep source admission closed, preserve both
   sides and escalate to the runtime operator. The per-host mTLS client offers
   `expect-move`, `replicate`, `replication`, `release`, `adopt`, `move-holding`
   and `drop-staged` for directed recovery. These are lower-level operations,
   not a substitute for the control-plane workflow: inspect their current
   `--help`, move stage, ownership and staged storage before using them under
   an approved recovery plan. Never start both copies with the same macrod
   credential or drop the only recoverable dataset.

Automatic rollback needs the destination's latest writes to be readable. If
that host or its storage is lost, recovery from the source's final copy can
lose post-cutover writes; approve and record that recovery point explicitly.
After commit the source copy is gone: an ordinary reverse relocation is a new
move through the API, not an automatic rollback of the committed move.

Keep the host closed until every computer has a verified terminal move result
and reservations are accounted for. A `rolled_back` computer still occupies the
source, so that host cannot be retired. Host shutdown or deletion requires its
own explicit approval after inventory and storage checks.
