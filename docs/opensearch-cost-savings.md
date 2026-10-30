# OpenSearch prod cost savings

Status: investigation, 2026-10-30. Read-only against production: Cost Explorer,
the Price List and Savings Plans APIs, CloudWatch, `describe-domain`, a read-only
`pulumi preview`, and `GET` requests to the cluster. Nothing on the domain was
changed.

Every number is tagged **measured** (read from AWS or the cluster, command
below) or **estimate** (derived; the derivation is shown). Prices are us-east-1
on-demand list rates from the Price List API on 2026-10-30, at 730 h/month.

## Summary

- **Actual prod spend is about $1,301/month** (September 2026, the last full
  month; **measured**), not the $1,364 list estimate. The gap is the
  IOPS/throughput line: the 4,200 IOPS are the free gp3 baseline at 1,400 GiB,
  so only the 100 MiB/s above the 250 MiB/s baseline is billed ($19.20/month,
  not about $72). Dev adds $140/month. No reserved instances or Savings Plans
  cover OpenSearch today (**measured**).
- **Volumes can't shrink.** Each data node already holds about 500 GiB (36% of
  1,400 GiB), up from 319 GiB on Oct 2. Growth over the last 27 days was
  6.4 GiB/node/day, and 9.6 GiB/node/day in the last week (**measured**). An
  emails rewrite alone needs about 343 GiB of free space per node. The earlier
  plan to right-size to about 500 GB assumed August usage and doesn't hold.
- **The domain is close to two hard limits.** `r7g.large.search` caps gp3 at
  1.5 TiB (we're at 1,400 GiB). The largest emails shard is 63.4 GB (59.1 GiB),
  against the 65 GB single-shard limit for Multi-AZ with Standby
  (**measured** / AWS quota). Emails needs a reshard, which is a full rewrite,
  within weeks. That makes free disk headroom something to protect, not to
  trim.
- **The dedicated masters are oversized.** Master CPU peaks at 27% (1-minute
  p99 ≤ 20%), and old-gen heap stays at or below 9% of the 8 GiB heap
  (**measured**). `m7g.large.search` (8 GiB RAM, 2 vCPU) meets AWS master
  sizing for this cluster and saves $94/month. AWS documents a master-type
  change as an in-place update, not blue/green.
- **Commitments are the other real lever.** 1-year no-upfront reserved
  instances save 31%; Database Savings Plans, which now cover OpenSearch
  instances, save only 20% (**measured** rates).
- **Net achievable saving: about $307/month (23%), taking prod from about
  $1,311 to about $1,005/month on list prices.** That's roughly what the prior
  pass predicted, but from different levers (masters and commitments, not
  volumes). And the baseline is rising: at October's growth rate, prod needs
  another capacity step (about +$390/month on-demand) within roughly 2–4
  months.

### Recommendation

1. **Reshard emails first.** This isn't a cost item, but it's the most urgent
   one: shards are at 63.4 GB of 65 GB. Build `emails_v2` with 12 primaries
   and the `zstd` codec, reindex, then swap the alias. Do it while the
   ~850 GiB of free space per node still covers a full copy.
2. **Move dedicated masters to `m7g.large.search`** ($94/month). The PR that
   adds this report makes that one-field change. Roll it out with a dry run
   in an off-peak window (see [Rollout](#rollout)).
3. **Buy commitments after the capacity plan is decided.** The 1-year
   no-upfront RI for 3× `m7g.large` masters ($92/month) is safe once the new
   masters have run for two weeks. For data nodes, buy 3× `r7g.large` 1-year
   no-upfront RIs ($120/month) only if the next capacity step scales *out* on
   `r7g.large`. If it scales *up* to `r7g.xlarge`, a type-locked RI would be
   stranded; use a Database Savings Plan (20%, type-flexible) or wait.
4. **Keep the 1,400 GiB volumes and the 4,200 IOPS / 350 MiB/s pin.** Start
   capacity planning now; see [Growth and runway](#growth-and-runway).

For the turbopuffer comparison: price it against a corpus of about 494 GiB
of primary data (≈ 251M primary docs), growing several GiB a day, not against a
shrunk $1,035/month domain. This report doesn't price turbopuffer.

## Current state

### Spend (measured)

Cost Explorer, service `Amazon OpenSearch Service`, grouped by usage type.
Record type is `Usage` only: no RI fees, Savings Plan coverage, or credits.

| Usage type | Jul | Aug | Sep | Oct 1–29 | Sep rate |
| --- | --- | --- | --- | --- | --- |
| `ESInstance:r7g.large` (prod 3 data + 3 master) | $794.59 | $794.59 | $768.96 (4,320 h) | $740.12 | $0.178/h |
| `ESInstance:r7g.medium` (dev 2 data) | $132.43 | $132.43 | $128.16 (1,440 h) | $123.35 | $0.089/h |
| `ES:GP3-Storage` (prod 3×1,400 + dev 2×50 GB) | $132.81 | $361.28 | $524.60 (4,300 GB-mo) | $488.64 | $0.122/GB-mo |
| `ES:GP3-Provisioned-ThroughPut` | – | $10.63 | $19.20 (300 MiBps-mo) | $17.88 | $0.064/MiBps-mo |
| `ES:GP3-PIOPS` | – | – | – | – | $0.008/IOPS-mo |
| Data transfer | $0.17 | $0.12 | $0.12 | $0.12 | |
| **Total** | **$1,060.01** | **$1,299.06** | **$1,441.04** | **$1,370.12** | |

September split: **prod ≈ $1,300.68** ($768.96 instances + $512.40 storage +
$19.20 throughput + $0.12 transfer), **dev ≈ $140.36**. At 730 h, prod's list
run-rate is **$1,311.24/month** ($779.64 instances, $512.40 storage, $19.20
throughput).

The September throughput charge is exactly 3 × (350 − 250) MiB/s, and there's
no `GP3-PIOPS` line in any month. So at 1,400 GiB the gp3 baseline is
4,200 IOPS (3 IOPS/GiB above 1,024 GiB) and 250 MiB/s (above 170 GiB). That
matches AWS's published OpenSearch gp3 baseline rules.

```sh
aws ce get-cost-and-usage --time-period Start=2026-07-01,End=2026-10-30 \
  --granularity MONTHLY --metrics UnblendedCost UsageQuantity \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon OpenSearch Service"]}}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE
aws ce get-cost-and-usage ... --metrics UnblendedCost AmortizedCost NetAmortizedCost \
  --group-by Type=DIMENSION,Key=RECORD_TYPE
aws opensearch describe-reserved-instances          # → []
aws savingsplans describe-savings-plans             # → []
aws pricing get-products --region us-east-1 --service-code AmazonES \
  --filters Type=TERM_MATCH,Field=regionCode,Value=us-east-1
aws savingsplans describe-savings-plans-offering-rates --savings-plan-types Database \
  --products OpenSearch --filters name=region,values=us-east-1
```

### Domain (measured)

`aws opensearch describe-domain --domain-name macro-opensearch-prod`:
OpenSearch_3.5 (`OpenSearch_3_5_R20260316`); 3× `r7g.large.search` data,
3× `r7g.large.search` dedicated masters; Multi-AZ with Standby across 3 AZs;
gp3 1,400 GiB/node with 4,200 IOPS and 350 MiB/s; Auto-Tune on; off-peak
window at 02:00 UTC. Advanced options include
`override_main_response_version: true`; that's why the root endpoint reports
7.10.2. The last domain change (`describe-domain-change-progress`) was the
Aug 14 volume increase.

### Disk (measured)

Cluster access: SSH to the bastion timed out from the investigating machine, so
the reads went through SSM port forwarding on the same in-VPC instance, with
`macrouser` credentials read from Secrets Manager
`macro-opensearch-password-prod` at request time. GET only:

```sh
aws ssm start-session --target <bastion instance id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<prod vpc endpoint>"],"portNumber":["443"],"localPortNumber":["9210"]}'
# Pass credentials on stdin so the password never appears in the process list.
printf 'user = "macrouser:%s"\n' "$PASSWORD" | \
  curl -K - --connect-to <prod vpc endpoint>:443:localhost:9210 https://<prod vpc endpoint>/_cat/allocation?v
#   …/_cat/indices?v&bytes=gb&s=store.size:desc&expand_wildcards=all
#   …/_cat/shards?v&bytes=b
#   …/<index>/_stats/segments,store,docs?include_segment_file_sizes=true&level=indices
#   …/<index>/_settings?include_defaults=true, …/_mapping, …/_cluster/settings?include_defaults=true
```

`_cat/allocation`: 74 shards per node; `disk.used` 496–508 GiB of 1.3 TiB
(36%), 870–882 GiB available per node. AWS reserves up to 20 GiB per node.

| Index | Pri × rep | Docs | Deleted docs | Total | Primary |
| --- | --- | --- | --- | --- | --- |
| `emails_v1` | 6 × 2 | 125.9M | 25.0M | 1,033 GiB | 342 GiB |
| `documents_v2` | 6 × 2 | 120.2M | 6.0M | 414 GiB | 137 GiB |
| `chats_v2` | 6 × 2 | 4.4M | 0.4M | 43 GiB | 14 GiB |
| `agent_sessions_v1` | 6 × 2 | 47K | 7K | 4 GiB | 1.6 GiB |
| `channels_v2`, `call_records_v2`, `projects_v1` | 6 × 2 each | 515K | – | < 1 GiB | < 1 GiB |
| 20 system indices (`.kibana*`, `.plugins-*`, `.opendistro*`, …) | 32 primaries × 2 | < 1K | – | < 1 GiB | < 1 GiB |

The 7 application indices are 126 shard copies and the system indices are 96,
which gives the 222 active shards, or 74 per node. Each node holds one full
copy of every index (3 copies across 3 nodes).
No superseded indices remain: there are no `documents_v1`, `chats_v1`,
`call_records_v1` or `channels_v1` indices, and every alias points at the
index listed above. `emails` is still on `emails_v1`. `helpers/constants.ts`
names `emails_v2`, which exists on dev only; the search team's ops notes record it as
deferred for disk on 2026-08-05.

The largest emails shards are 63.4 GB (59.1 GiB); the others are 61.9–62.5 GB.
`documents_v2` shards are about 25 GB.

Watermarks (`_cluster/settings`): low 25 GB, high 22 GB, flood 10 GB free,
absolute.

### Growth and runway

**Measured** (CloudWatch `ClusterUsedSpace` and `FreeStorageSpace` Minimum,
daily, 455 days; per node = cluster used ÷ 3):

| Date | Used per node | Note |
| --- | --- | --- |
| 2025-08-01 | 28 GiB | |
| 2026-05-06 to 05-09 | 0 GiB free on the smallest node | `ClusterIndexWritesBlocked`; 200 GiB volumes, raised to 256 in #3400 |
| 2026-07-15 | 0 GiB free | writes blocked during the emails millis backfill; raised to 400 GiB in #4905 |
| 2026-07-31 | 303 GiB | |
| 2026-08-13 | 0 GiB free | writes blocked for 4 h; raised to 1,400 GiB the next day in #5661 |
| 2026-10-02 | 319 GiB | after a September cleanup of about 90 GiB |
| 2026-10-22 | 425 GiB | |
| 2026-10-29 | 492 GiB | 858 GiB free on the smallest node |

- Last 7 days: +9.6 GiB/node/day. Last 27 days: +6.4 GiB/node/day. Last
  90 days: +2.1 GiB/node/day (net of the September cleanup).
- Primary doc count rose from 162.7M (Oct 2) to 250.7M (Oct 29).
- Emails grew from 76.9M docs and about 213 GiB of primaries (search ops
  notes, 2026-08-05) to 126.0M docs and 342 GiB, about 1.5 GiB/day of primaries.
- Indexing churn on emails since the current nodes started (about 100 days):
  369M index operations and 222M deletes (`_stats/indexing`).

**Estimate:** minimum safe volume per node =
used + largest-index rewrite + merge scratch + high watermark + AWS reserve
= 492 + 343 + 40 (scratch observed on the 2026-08-05 rewrite) + 22 + 20
≈ **917 GiB today, with zero growth**. With growth, both the used and the
emails terms grow (emails is about 70% of the per-node footprint):

| Growth rate | Rewrite-safe runway at 1,400 GiB | Runway to flood stage | Growing to the 1,536 GiB cap adds (rewrite-safe) |
| --- | --- | --- | --- |
| 2.1 GiB/day (90-day) | ≈ 125 days | ≈ 400 days | ≈ 38 days |
| 6.4 GiB/day (27-day) | ≈ 40 days | ≈ 130 days | ≈ 12 days |
| 9.6 GiB/day (7-day) | ≈ 27 days | ≈ 88 days | ≈ 8 days |

Rewrite-safe means free space stays at least emails + 40 + 22 GiB, which
shrinks by about 1.7 GiB for each GiB of growth.

`r7g.large.search` can't exceed 1.5 TiB of gp3 (AWS quota). The next storage
step is therefore 3 more `r7g.large` data nodes (about +$390/month, keeps any
`r7g.large` RIs useful) or 3× `r7g.xlarge` (about +$390/month, plus double the
page cache, which could help search latency). Which one is a separate
decision. Either way, cutting the volume now would be undone within weeks.

### IOPS and throughput (measured)

Per data node, read + write combined at matching timestamps. Average stat for
the 15-day window, which CloudWatch reports at about 5-minute resolution for
these metrics; hourly Maximum stat for 100 days.

| Metric | 15-day p50 | p95 | p99 | max | 100-day hourly max (p99 / max) |
| --- | --- | --- | --- | --- | --- |
| Total IOPS | 476–484 | 1,221–1,255 | 1,462–1,484 | 1,878–2,026 | 1,554–1,574 / 2,055–2,184 |
| Total throughput | 5.9 MB/s | 23.6 MB/s | 37–43 MB/s | 93–98 MB/s | 90–93 / 123–143 MB/s |
| Read IOPS microburst (sub-minute) | | | | | max 6,925–8,815 |
| Read throughput microburst | | | | | max 237–345 MB/s (≤ 329 MiB/s) |
| Write throughput microburst | | | | | max 344–602 MB/s |

- `IopsThrottle`: 0 for 100 days.
- `ThroughputThrottle`: 3 hours, all on 2026-08-05, when the volumes were
  400 GiB pinned at 250 MiB/s and the emails rewrite was running. 0 since the
  350 MiB/s pin on Aug 14.
- `BurstBalance` is a gp2 metric, so 0 here.
- `MaxProvisionedThroughput` is 350.
- Thread-pool search, write, coordinating, primary and replica rejections:
  0 for 100 days.

EC2 `describe-instance-types` for the `r7g.large` instance behind
`r7g.large.search` (assumed to match): baseline 3,600 IOPS / 78.75 MB/s, burst
up to 40,000 IOPS / 1,250 MB/s. Hourly peaks already exceed the sustained
instance baseline, so the volume isn't the sustained bottleneck.

Does the workload need 4,200 / 350? Average load would fit 3,000 IOPS and
125 MiB/s. But at this volume size, 125 MiB/s isn't available (the baseline is
250 above 170 GiB), and the 4,200 IOPS cost nothing. The only billable part is
the 100 MiB/s above baseline ($19.20/month). Read microbursts reach 329 MiB/s,
and the one time throughput was capped at 250 was during a rewrite, which is
the next planned operation. So keep the pin.

If the volume ever drops to 1,024 GiB or below, the IOPS baseline falls to
3,000, and a pinned 4,200 would start costing 1,200 × $0.008 × 3 =
$28.80/month. Keep the throughput pinned on any size change; #4905 added the
pin because a resize reverts to the default.

### Compute (measured)

Data nodes:

| Metric | 15-day 1-min p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- |
| CPU % | 31–33 | 64–68 | 76–80 | 98–99 |
| JVM memory pressure % | 42–43 | 69–70 | 72 | 85–90 |
| SearchLatency (ms) | 0.3 | 13–14 | 69–72 | 934–1,672 |

- The 100-day hourly-average CPU p50 is about 15%, so CPU has roughly doubled
  with October's indexing.
- Old-gen JVM pressure: hourly-max p99 22–23%, max 42–50%.
- Hourly-max `IndexingLatency` p99 is 4.7–5.3 ms.

Masters (`MasterCPUUtilization`, `MasterJVMMemoryPressure`,
`MasterOldGenJVMMemoryPressure`):

| Metric | 15-day 1-min p95 | p99 | max |
| --- | --- | --- | --- |
| CPU % (2 vCPU) | 9–13 | 17–20 | 21–27 |
| JVM % (heap sawtooth) | 60–65 | 63–68 | 63–69 |
| Old-gen JVM % | | | 3.6–9.0 (100-day) |

The cluster has 6 nodes and 222 shards. AWS master sizing for OpenSearch 2.17
and later: 4 GB RAM covers up to 10 nodes and 5K shards, 8 GB covers 30 nodes
and 15K shards. The older 1–10 data-node guidance named `m5.large`/`m6g.large`
(8 GiB) as the minimum. Multi-AZ with Standby supports `m7g`.

**Estimate:** today's `r7g.large` masters have 16 GiB RAM and an 8 GiB heap, so
a 9% old-gen peak is about 0.7 GiB of live data. That would be about 18% of
the 4 GiB heap on an 8 GiB `m7g.large`. Peak master CPU stays about 27% on
2 vCPU.

Data nodes can't drop a size. CPU p95 is 64–68% and peaks hit 99%, search
latency is an open problem, and no cheaper type even holds the volume:
`r7g.medium`, `m7g.large` and `m8g.large` cap gp3 at 768 GiB, and `c7g.large`
at 256 GiB.

### Engine-level waste

All per-node figures equal the primary size, because each node holds one full
copy.

| Item | Measured | Reclaimable per node (estimate) |
| --- | --- | --- |
| Stored fields (`_source`), LZ4 `default` codec | `fdt` = 226.6 GB of 368 GB (emails), 91.3 of 148 (documents), 10.1 of 15.8 (chats), 1.0 of 1.6 (agent sessions) | 20–40% of 329 GB with `zstd` / `zstd_no_dict` ≈ **66–132 GB**; needs a rewrite (reindex or close + set codec + force merge) |
| Deleted docs awaiting merge | emails 16.5% of docs, documents 4.7% | ≈ 57 GiB emails + ≈ 7 GiB documents, transient; refills with churn (222M email deletes in 100 days) |
| Leftover v1 indices | none on disk | 0 |
| Replicas | 2 everywhere, the minimum for Multi-AZ with Standby (3 copies) | 0 |
| Over-sharded small indices | 18 shards each for channels, calls and projects at < 1 GiB | 0 disk; small heap and cluster-state cost |
| Legacy `*_seconds` date fields | no non-test reader or writer in `opensearch_client` or `search_processing_service` since #4912 | ≤ 2 GB (doc values plus old `_source`); drop at the next emails rewrite |
| `_source` needed? | yes: highlights read `content` from `_source`, reindex and `update_by_query` (email properties) need it | 0; disabling `_source` or excluding `content` would break search |
| `agent_sessions` `inner_hits` `_source` | 100 child hits per term return full `_source` (a 15.9 MB dev response, per the search ops notes) | 0 disk (index is 1.6 GiB); a latency and payload item, already tracked as a search-performance task |

None of these reduce the bill unless volumes shrink, which the growth rules
out. Their value is runway. The codec change mostly lands with the emails
reshard: about 45–90 GB of emails stored fields, or 13–26% of today's per-node
emails footprint, plus a slower growth slope.

### Logs (measured)

| Log group | Retention | Stored | September ingest |
| --- | --- | --- | --- |
| `…/macro-opensearch-prod/search-slow-logs` | 30 d | 0.60 GB | 0.34 GB |
| `…/application-logs` | 7 d | 0.001 GB | 0.015 GB |
| `…/index-slow-logs` | 30 d | 0 | ≈ 0 |

At $0.50/GB vended ingest and $0.03/GB-month storage, that's about
$0.20/month. Not material.

## Options

Savings are list prices at 730 h, against today's $1,311.24/month prod
run-rate.

| Lever | $/month saved | Risk | Reversibility | Verdict |
| --- | --- | --- | --- | --- |
| Masters `r7g.large` → `m7g.large` (this PR) | **94.17** (measured rates) | Low. Masters sit at ≤ 27% CPU and ≤ 9% old-gen; AWS documents the change as in-place, not blue/green; confirm with a dry run | Revert the PR or set the type back (also in-place) | **Do** |
| 1-yr NURI, 3× `m7g.large` masters | 91.98 | 1-yr commitment on a tier that won't change | None for the term | **Do** after two stable weeks |
| 1-yr NURI, 3× `r7g.large` data | 120.45 | Stranded if data nodes move to another type within the year | None for the term | **Do** only if scaling out on `r7g.large` |
| 1-yr PURI / AURI, data | 127.92 / 136.32 | As above, plus cash upfront | None | Marginal over NURI |
| 3-yr NURI / PURI / AURI, data | 186.15 / 193.85 / 202.74 | High: growth and the turbopuffer decision make 3 years unlikely to fit | None | Reject for now |
| Database Savings Plan, 1-yr no upfront (all 6 at today's types) | 77.96 data + 59.13 masters on `m7g` | Low; flexible across family, size and other database services | None for the term | Fallback if data nodes will change type |
| Throughput 350 → 250 MiB/s | 19.20 | Medium: the next planned operation is a rewrite, which throttled at 250 before; read bursts reach 329 MiB/s | Raising it back is in-place; an EBS change within 6 h of the last one is blue/green; dry-run a decrease | Reject until after the emails rewrite |
| IOPS 4,200 → 3,000 | 0 (4,200 is the free baseline at 1,400 GiB) | n/a | n/a | No change |
| Volume 1,400 → 1,024 GiB | 137.62 | **High**: 917 GiB is needed today for a rewrite, and the margin is gone in about 2 weeks of growth; a shrink is blue/green, copying about 1.5 TB | Another blue/green | **Reject** |
| Volume 1,400 → 500 GiB (prior pass) | 329.40 | Impossible: 492 GiB already used per node | n/a | **Reject** |
| Data nodes smaller or cheaper | n/a | No cheaper type supports ≥ 1,400 GiB gp3; CPU p95 64–68% | n/a | **Reject** |
| Masters to 1 vCPU (`r7g.medium` / `m7g.medium`) | 194.91 / 240.90 | Medium: peaks about 54% of one vCPU, master load spikes during blue/green, and the next capacity step is a blue/green | In-place | Defer; revisit with `m7g.large` data |
| Index cleanup (codec, expunge deletes, drop `*_seconds`) | 0 now | Codec: small fetch-phase CPU cost; force merge is heavy I/O | Rewrite back | Do as part of the emails reshard, for runway |
| Log retention | ≈ 0.2 | n/a | n/a | Not worth changing |

**Recommended total: $94.17 + $91.98 + $120.45 = $306.60/month**, taking prod
from $1,311.24 to about $1,004.64/month (−23%). Without the data-node RI
(the scale-up case), it's $186.15/month, or $264.11 with a Database Savings
Plan on the data nodes.

## Rejected options and why

- **Shrinking volumes (to 500 or 1,024 GiB).** Usage is already 492 GiB per
  node and rising 6–10 GiB/day. Emails needs a rewrite-sized hole of about
  343 GiB for the reshard. Free space has run out three times (May 6–9,
  Jul 15, Aug 13), each during a rewrite or backfill, and each time writes
  were blocked. A shrink is also a blue/green that copies
  the whole cluster during an active latency problem.
- **Throughput down to the 250 MiB/s baseline.** It saves $19.20, and the only
  recorded throttling happened at 250 MiB/s during a rewrite.
- **Dropping the IOPS pin.** Nothing to save at 1,400 GiB, and the pin
  protects a future resize from reverting (#4905).
- **Smaller data nodes, `c7g` or `m7g` data nodes, OR1/OR2.** CPU headroom
  isn't there, the gp3 caps are too low (`m7g.large` 768 GiB, `c7g.large`
  256 GiB), and `or2.large` costs more per hour ($0.200) before its S3
  storage charges.
- **Fewer replicas, Multi-AZ without Standby, 2 AZs.** Multi-AZ with Standby
  mandates 3 copies, 3 masters and data nodes in multiples of 3. Dropping it
  gives up the 99.99% SLA, so it isn't a provisioning fix.
- **Database Savings Plans as the default commitment.** OpenSearch instances
  get 20% (1-year, no upfront only) and storage isn't covered, against 31% for
  a 1-year no-upfront RI. Use one only where type flexibility is worth 11
  points.
- **3-year terms.** The cluster is likely to change shape within a year.

## Rollout

Order matters: Multi-AZ with Standby accepts one change at a time, and the
emails reshard needs headroom more than anything else does.

1. **Emails reshard** (owner: Search). Shards are at 63.4 GB of 65 GB.
   Register a manual snapshot repository (S3 plus an IAM role; today only the
   AWS-managed `cs-automated-enc` exists) and take a manual snapshot. Create
   `emails_v2` with 12 primaries, 2 replicas, `index.codec: zstd_no_dict` (or
   `zstd`), and no `*_seconds` fields. Reindex in throttled, resumable slices
   with a free-disk floor, as in the search ops notes' rewrite procedure; swap the
   `emails` alias; delete `emails_v1` only after verification. Rollback: swap
   the alias back to `emails_v1`, which stays until then.
2. **Masters to `m7g.large.search`** (this PR). Merging deploys it:
   `Deploy opensearch` runs on every production release, so the change lands
   at the next release after merge. Either merge just before a planned
   release, or apply in the window yourself and then merge so the release
   sees no diff:
   - Precheck: the domain is `Active` and green, no change is in progress
     (`aws opensearch describe-domain-change-progress`), and the latest
     automated snapshot succeeded (`_cat/snapshots/cs-automated-enc`,
     hourly; 74/74 shards at 06:52 UTC on 2026-10-30).
   - Dry run, with a cluster config identical to today's except the master
     type:

     ```sh
     aws opensearch update-domain-config --domain-name macro-opensearch-prod \
       --cluster-config '{"InstanceType":"r7g.large.search","InstanceCount":3,
         "DedicatedMasterEnabled":true,"DedicatedMasterType":"m7g.large.search",
         "DedicatedMasterCount":3,"ZoneAwarenessEnabled":true,
         "ZoneAwarenessConfig":{"AvailabilityZoneCount":3},
         "MultiAZWithStandbyEnabled":true}' \
       --dry-run --dry-run-mode Verbose
     ```

     A verbose dry run can return `pending` with a `DryRunId`. Poll until it
     finishes:

     ```sh
     aws opensearch describe-dry-run-progress \
       --domain-name macro-opensearch-prod --dry-run-id <id>
     ```

     Proceed only on `DryRunStatus: succeeded`, no `ValidationFailures`, and
     `DeploymentType: DynamicUpdate`. If it reports `Blue/Green`, stop and
     re-plan: a blue/green here copies about 1.5 TB and should run off-peak
     with the emails reshard already done.
   - Window: off-peak, matching the domain's 02:00 UTC window.
     `pulumi preview --stack macro-inc/prod` should show only
     `dedicatedMasterType: "r7g.large.search" => "m7g.large.search"`.
   - Verify: change progress `COMPLETED` with stage "Applying dedicated master
     related changes"; `_cat/nodes?v&h=name,node.role,master` shows three
     cluster-manager nodes; cluster green. For the next week, `MasterCPUUtilization`
     p99 stays under 50%, `MasterJVMMemoryPressure` keeps its sawtooth under
     75%, and data-node `SearchLatency` and `IndexingLatency` match the prior
     week.
   - Rollback: revert this PR, or set `DedicatedMasterType` back to
     `r7g.large.search`. It's the same in-place path, once the domain is
     `Active` with no change in progress.
3. **Reserved instances.** Buying them is a billing commitment, so finance
   signs off. Masters: 3× `m7g.large.search` 1-year no upfront, after two
   stable weeks. Data nodes: decide the capacity step first (out on
   `r7g.large` vs up to `r7g.xlarge`), then buy 1-year no-upfront RIs for the
   type that will stay, or cover the data nodes with a Database Savings Plan.
4. **Capacity step.** Plan it now from the runway table. Increasing volume
   size, IOPS or throughput on gp3 and adding data nodes are in-place;
   changing the data-node type is blue/green.

## What was not verified

- **turbopuffer pricing** for this corpus. Not part of this pass.
- **Which index drives October's growth.** CloudWatch has no per-index
  history, and a date-histogram over 250M docs on prod was skipped to avoid
  load during the latency problem. The emails figures above come from the
  ops notes' 2026-08-05 snapshot.
- **Why emails logs 222M deletes in 100 days** (delete-by-query on link, user
  or message ids, then re-add?). Not traced.
- **`zstd` savings on our data.** The 20–40% is a typical range for
  text-heavy stored fields, not a measurement; benchmark it on a dev copy.
  The same goes for its fetch-phase CPU cost.
- **The dry run** wasn't run: it's an `UpdateDomainConfig` call against prod,
  outside this pass's read-only scope. The in-place claim rests on AWS's
  configuration-change documentation.
- **What AWS does when a shard passes 65 GB** on Multi-AZ with Standby
  (blocked updates, or a support case for a quota increase).
- **Whether `r7g.large.search` has the same EBS limits as EC2 `r7g.large`,**
  and the burst duration (AWS documents 30 minutes per 24 hours for EC2).
- **Whether Cost Explorer's September totals include credits** applied at the
  invoice level. Only the `Usage` record type appears.
- **Dev sizing.** Out of scope; it costs $140/month.
