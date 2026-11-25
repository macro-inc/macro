# Computer overcommit

Each Firecracker host runs more computers than its hardware holds at once:
allocation ratios let awake computers' vCPUs and memory exceed the host's,
and live memory limits keep what they actually use in check. Every setting is
a column of the host's `hosted_runtime_host` row, so tuning a host is an
`UPDATE`, never a deploy. How it works: the **Overcommit** and **Relief and
wakes** entries of [Macro computers](../architecture/macro-computers.md);
rollout order: [Firecracker computers rollout](../architecture/firecracker-computers-rollout.md).

## Settings

Defaults were measured on an n2-standard-32 (32 vCPUs, 128 GiB) restoring
4 vCPU / 8 GiB computers from one golden snapshot; every new host row gets
them.

| Column | Default | Why |
| --- | --- | --- |
| `cpu_allocation_percent` | 600 | 6:1 awake vCPUs. Idle computers cost ~0.04 cores each and bursty neighbours leave an active computer's latency unchanged. With every vCPU busy a computer runs ~9.5× slower at 6:1, but ~2.8× when the host agent gives active computers more `cpu.weight`, which it does. |
| `ram_allocation_percent` | 400 | 4:1 awake memory past the reserve. Measured resident: ~0.65 GiB idle, ~2.5 GiB lightly active; the live watermarks are the real guard, this only keeps admission sane. |
| `reserved_vcpus` | 2 | The host agent, restores (CPU-heavy on nested hosts) and kernel threads. |
| `reserved_memory_gib` | 16 | Kernel, agent, the golden snapshot's page cache and per-VM KVM overhead (~10 MiB each). |
| `oversell_factor` | 2 | Computers sold per awake one: hibernated and stopped computers hold no memory. |
| `memory_low_watermark_percent` | 70 | Relief stops below it; the host agent squeezes idle computers into zram above it. |
| `memory_high_watermark_percent` | 80 | At or above it the host admits no start or wake, and relief hibernates the idlest computers. |
| `memory_hard_ceiling_percent` | 90 | No start may take resident memory past it, and the host agent caps all guests' memory there (`memory.max` of the VMs' cgroup). |
| `start_resident_memory_mib` | 1536 | What a restored computer adds before it is measured. An enrolled computer that never ran a session holds ~0.83-0.97 GiB (base ~743 MiB, the agent adapter macrod starts at connect 88 MiB, the warm MCP spare 0-140 MiB); after a session ~1.35 GiB (the live Claude CLI kept between turns 265 MiB and the MCP server in use 108 MiB). |
| `minimum_idle_seconds` | 900 | Computers active in the last 15 minutes are never hibernated. |
| `memory_report_freshness_seconds` | 30 | A host whose report is older admits nothing (reports arrive every 10 s). |
| `max_concurrent_starts` | 1 | Fleet effects (creates, starts) and wakes at once on the host. Measured best is 8: a bounded queue restores a burst faster than running it all at once. |

Resident memory is the host's `MemTotal - MemAvailable`, guests and host
together, as the host agent reports it.

## What happens as memory fills

| Resident memory | Effect |
| --- | --- |
| Under the low watermark | Everything admitted that fits the allocation ratios. |
| Low to high | Still admitting; the host agent squeezes computers idle for 30+ minutes into zram. |
| At or above high | No starts or wakes (`computer.overcommit.refusals{reason:high_watermark}`); computers wait with the normal capacity backoff. The overcommit pass hibernates the idlest computers (idle 15+ minutes, no agent turn running or queued) until under the low watermark. |
| Near the hard ceiling | A start that would cross it is refused (`hard_ceiling`). The cgroup limit is a backstop only: at it the kernel kills a VM by size, not idleness. |
| No report for 30 s | Nothing admitted (`stale_memory_report`): the host agent or the pass is down. |

A hibernated computer stays on to its team and wakes when they power it on or
a prompt arrives for its macrod; wakes are admitted like starts.

## Change a live host

Connect to the environment's Postgres (see
[Database development](../development/database.md)) and update the host's row;
the CHECK constraints refuse incoherent settings (watermarks must rise, ratios
be positive):

```sql
-- Admit more awake memory on one host.
UPDATE hosted_runtime_host SET ram_allocation_percent = 500 WHERE name = 'fc-host-1';
-- Hibernate earlier and stop admitting sooner.
UPDATE hosted_runtime_host
SET memory_low_watermark_percent = 65, memory_high_watermark_percent = 75
WHERE name = 'fc-host-1';
-- Stop new purchases landing on a host (computers on it keep running).
UPDATE hosted_runtime_host SET admitting = false WHERE name = 'fc-host-1';
```

- Admission reads the row on every start: watermark and freshness changes
  apply at once.
- Sold and awake units (offers, `computer.capacity.*`) are recomputed when the
  host next registers, on the operator's next reconcile pass (every minute).
- The next overcommit pass (every 10 s) sends changed watermarks and the
  ceiling to the host agent.

## Diagnose

- Grafana, **Macro computers fleet** (hosts with
  `macro.firecrackerHost.alloy.enable`): host memory against the watermarks,
  awake vCPUs per core, the busiest and largest computers by `computer_id`,
  CPU held back by limits, host pressure, and memory sold per byte held.
  Raise a ratio only while pressure stays flat; a host whose CPU waiting
  climbs with few busy computers is short of CPU for another reason: check
  the host's own work and steal time first, and lower the CPU ratio only if
  neither explains it.
- Grafana, **Firecracker hosts: capacity**: fleet and per-host totals (cores,
  RAM, storage, vCPUs and memory limits committed, headroom to the default
  watermark), which hosts stopped reporting, and each host's running VMs.
- `computer.host.memory.used_ratio` against `…high_watermark_ratio` by `host`:
  how close each host is to refusing. `report_age` above 30 s means the host
  admits nothing.
- `computer.overcommit.refusals{reason}`: why starts and wakes wait.
- `computer.overcommit.hibernations{outcome:failed}`: relief could not free
  memory; the host keeps refusing until it can.
- Spans: `computer.overcommit.host` per host per pass, with
  `computer.overcommit.hibernate` and `computer.overcommit.wake` inside;
  `computer.wake_for_prompt` in agent_harness_service.
- Which computers sleep: `SELECT id, hibernated_at, wake_requested_at FROM
  hosted_runtime WHERE host_id = '<id>' AND hibernated_at IS NOT NULL;`. A
  `wake_requested_at` that stays set means the host has had no room since.
