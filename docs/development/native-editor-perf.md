# Native editor performance evidence

This ledger records existing measurements, not a release acceptance scorecard.
A candidate is the combination of frontend source, native source, generated
package, feature profile, fixture and environment. A short source name alone is
insufficient. Missing measurements are **unmeasured**, never zero.

## Build and measurement boundaries

ON means the ordinary Rust document session and native view. OFF means upstream
Lexical in the same frontend bundle, with exactly one audited engine-flag literal
changed. This is not the full Macro compatibility initializer. Plugin and
decorator coverage must be supplied with any future user-facing scorecard.

The first-Enter experiments use local-only production JavaScript: `MODE=production`,
`NODE_ENV=production`, actual `DEV=false`, `VITE_LOCAL_ONLY=true`, explicit local
transport, browser telemetry default-off and markdown search-text writer off.
Keep local routing explicit; changing to a development build changes hot paths.
The compiled Source graphs were checked against pristine Lexical/code-core
production sources, including Vite map `sourcesContent`, not package versions alone.

| Candidate | Frontend source | Native source / WASM SHA-256 | Native profile |
| --- | --- | --- | --- |
| Historical 0395 / 3b | `03958990475e7cfe6b316fe1ebfca5964d96962f` | `3b1907cb9900ac633d198c17512e91774a0fcc45` / `1424d8634496b8309b763eeacb3283c9c772b6cfeb65be9d3e8ca6cf11ab8def` | Ordinary `bebop-owned-all`, no dev-probes |
| 4ddec / 3488 | `4ddecff20a9dd985df9d2634f0f99703e003f174` | `3488ef763b87f83b269d6ead88429032bece50f3` / `047b41bca6da595b5efcc4e2c20d2023158c51fb85e08720c3de7191883c6750` | **Preview** `bebop-owned-all,dev-probes` |
| 50a2 production | `50a2b9b575d8f8755dc63c4d0460f20b5c4e0e8b` | Same source / `b1bffd2594df6ac9a47d08eb5d7a0d35aee4cb68508168c598398a4da293a98b` | Production `--no-default-features --features bebop-owned-all`; no dev-probes |
| 5cf / d732 | `5cfb2571fb74d4b5f4520750619dc0eb74748da7` | `d7326a3f9dfc55f70a3adc5debf356641fa71dd9` / unmeasured here | Source-counter diagnostic only; 80d absent |

The 50a2 preview package is a different artifact; do not substitute it for
`b1bffd25`. In particular, 4ddec and 50a2 are not a controlled test of one change.

## Metric catalog and reproduction

The absolute paths below identify retained local evidence, not checked-in tools
or portable commands. Copy a producer into an owned directory and rebind its
configuration before running it. Historical scripts can contain hardcoded output,
room and service paths. Keep authentication and account/document identifiers out
of this document. No new experiments were run to assemble this ledger.

### First Enter and the keyDown WASM share

**Latency:** trusted keydown timestamp to the first MutationObserver publication
of the exact paragraph split near the top of a 5000-paragraph document. This is
**DOM publication, not paint or PRESENTED**. The saved Source-produced fixed-point
fixture has 10001 nodes, root metadata version 10 and `environmentTags:null`,
an 83-character first text and caret offset 12. Both arms start from identical
bytes; full post-key graph, text and caret checks remain exact.

Fixture: `production-enter-0395-01/source-fixed-point-5000/snapshot.bin` under the
performance root below; SHA-256
`cbfbc89ee288d8184b14676b15b717f4aa2ccd364223e0c2869b89daf421597b`.
Model SHA-256:
`a3bc687e35bb141cd95f6d4001a9abfa1a21f40668d4e22a67e893a558afd588`.

Producer directories under `/home/wolf/tmp/lexical-port/editor-perf/`:
`production-enter-0395-01`, `production-enter-4ddec-01`,
`production-enter-50a2-01`. Each binds `run-timing.py`, `run-case.py`,
`run-enter-case.ts`, `enter-page-probe.js`, `qualify-observation.mjs`,
`check-block.mjs`, protocol, plan and analyzer in its seal.
From the configured producer directory the recorded launch form is:

```sh
bash --noprofile --norc -c 'source /home/wolf/tmp/pr-landing/devshell.rc; nice -n19 python3 run-timing.py'
python3 analyze-timing.py
```

Actual auth/controller runtime is Node 24. Each key uses a fresh stock browser
process/context (Chrome for the new runs; timing02 also covers Firefox) and fresh normal-worker storage-cold room seeded with the literal
snapshot. Timing02 also includes stock Firefox. The passive evidence listener is
in the bubble phase; capture listeners previously perturbed admission ordering.
No full model export runs before the measured key. Separate full-model controls
precede sampling; post-key validation is outside the endpoint.

Eight balanced ABBA/BAAB blocks per browser give 16 observations per arm.
Ratios are ON/OFF; intervals are whole-block percentile bootstrap 95% CIs
(10000 resamples, seed 591104), with type-7 quantiles. Record load per observation;
reject/repeat an entire block with more than 2x load swing, at most three attempts.
The 50a2 run additionally stops above load 150, checked before each block and
on completed observations. Earlier runs had no such absolute ceiling.
Startup-error exemptions are exact, run-specific sealed rules, not blanket waivers.
The stopped timing01 run is retained and excluded from timing02.

**WASM share:** marked actual `keyDown` call CPU/wall brackets exclude subsequent
view application. Use `run-cpu-phase-case.py`/`.ts`, `cpu-phase-probe.js`,
`thread-cpu-markers.js` and `analyze-thread-cpu-phase.py` in the corresponding
producer. Function drilldown uses the audited exact-CODE 3b named map at
`/home/wolf/tmp/silky-profile/native-3b1907-named-01/`; ambiguous symbols are
excluded. Do not transfer these symbols to another artifact.

Rank phases by thread CPU: end `tts` minus begin `tts` for marked method
intervals, and `tdur` for complete trace events. Total dispatch-to-DOM CPU starts
at the actual EventDispatch entry, not a backdated key mark. Keep wall time beside it. Nested
selection/layout/reconcile costs cannot be added to inclusive view time.
Execution sample counts are not CPU percentages. Lazy compile attribution needs
compile events: absence from a trace means unavailable, not zero. Single marked
profiles do not decompose the median of a separate timing experiment.

### Select-all + Delete

| Metric | Candidate result | Harness / fixture |
| --- | --- | --- |
| Select-all + Delete | Unmeasured | Not yet bound |

**Unmeasured.** No qualified candidate result, fixture or command is bound yet.
The proposed metric is trusted Ctrl+A followed by Delete in a large document,
with selection completion and deletion latency reported separately. Reuse the
first-Enter trace method to distinguish WASM, view, DOM and thread CPU, but seal
an exact workload and endpoint before collecting. A DOM deletion witness is not
presentation. Preserve exact final model, caret, Undo and OFF controls. Do not
infer a value from first-Enter or held-selection profiles.

### Historical plain-text paste block

Retained controller:
`/home/wolf/tmp/silky-profile/paste-static-0395-regress-04/run-one-chrome-block.py`
launches `run.mjs`/`driver.mjs`; exact script and package pins are in PASTE below.
The literal `novel.txt` has SHA-256
`d832332740af261934bd1116a1d5e217a50b03ad9ca0210e33a652245e730e99`,
1216731 UTF-16 units and 2801 paragraphs. Do not regenerate it.
Endpoint: trusted paste to first large DOM publication, **not painted content**.
Two semantic controls precede one ABBA block, two observations per arm, nonquiet,
load below 150. Both use frontend 0395; baseline is 3b/1424 and candidate is
`d1fca7a8`/`e622` (full pins in PASTE). This is a historical matched leaf
comparison, not an installed-candidate or ON/OFF scorecard.
Joined output text equality is not full serialized JSON equality.

### Cold-bind 80d kernel

Source `80d000acfb73ab35bb3fc85002d1ce9dcddf3e1c`, parent
`f9e1c9c7953fce0ac0c7aaa3ae2505d9f387f558`. `validated_state_id` avoids building
an intermediate serde tree just to find an ID. Whole deep-value extraction and
JSON admissibility validation before index mutation remain; no binding walk or
callback is skipped. The test materialization count 3 to 0 is not an allocator count.

Producer: `/home/wolf/tmp/lexical-port/editor-perf/cold-bind-01/`.
Exact frozen builds and commands are in `native-seal.json` and `native-build-*.json`;
`python3 collect-native.py NEW_OUTPUT` collects and
`python3 analyze-native.py NEW_OUTPUT` analyzes the sealed
binary pair. Fixtures have 100/1000/5000 paragraphs (201/2001/10001 nodes).
Each process warms two full binds, then measures five full rebinds; its observation
is mean milliseconds per pass. Eight balanced blocks, 32 processes, 96 size cells.
This is a warmed repeated-bind kernel despite the historical “cold-bind” name;
it is not cold first Enter, a browser result or total projection latency.

### Loro local_commit and fixed-work counters

The retained synthetic application fixture enters inside the first paragraph,
at first-text UTF-16 offset 12, in
50/500/5000-root-paragraph documents, cold and after real Undo (six rows).
Use the exact scratch patch and dependency witness bound by LOCAL or FIXED below;
these are never-shipped optional diagnostic hooks, not counters in a shipping WASM.
The LOCAL command from the owned scratch tree is:

```sh
bash -c 'source /home/wolf/tmp/pr-landing/devshell.rc && TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=2 nice -n19 ionice -c3 cargo test --locked -p document_session --features application,work-probe --lib editor::enter_work_probe_test -- --nocapture'
```

FIXED uses the same command with filter `editor::enter_fixed_work_probe_test`.

The historical 3b probe aggregates UserLen/IncludeDead cache-length predicate
callbacks, not unique visited items. Current 5cf/d732 uses a different metric
schema for selected with_txn, operation and clone-expression events; numeric IDs
cannot be compared across schemas. Counts say nothing about CPU, allocations,
lock contention, WAL or ACK latency. Standalone vendor helper tests were blocked
with zero executed; the six fixture rows and bounded data audit passed. First-pass,
search and other unmetered work remain open.

### H1 / H2 / H3 work probes

PROBE H1 counts `text_content` calls that find a slot of any node kind, while a
ModelCaches context is anywhere on the probe stack (the hook precedes the walk).
H2 counts splice child collection; H3 counts diff child collection. These are
different units. PROBE uses `/home/wolf/tmp/enter-first-cost/src` at detached
`3b1907cb9900ac633d198c17512e91774a0fcc45`, plus uncommitted `probe-3b.patch`
SHA-256 `3c02b519f8c5a449c91ade734f40b22f7939b0366cfb8bcdf43e3c53c599e6ae`.
Unlike LOCAL/FIXED, its recorded command does **not** use `--locked`:

```sh
bash -c 'source /home/wolf/tmp/pr-landing/devshell.rc && TMPDIR=/home/wolf/tmp CARGO_BUILD_JOBS=2 nice -n19 ionice -c3 cargo test -p document_session --features application,work-probe --lib editor::enter_work_probe_test -- --nocapture'
```

Its single-run exact
baseline at N=50/500/5000 is H1 `4N+6` = 206/2006/20006, H2 `N+1` = 51/501/5001,
H3 `2N+2` = 102/1002/10002. Cold and warm match; overflow is false.
Projection children/nodes/writes are 1/7/2. These are not timing measurements.

H1 source `ecd5ff559c625bb0d7338528167045bfe7c3a03e` on shared counter parent
`15e125163433d7bdc87196a56e3bb4cfe0b438ca` has a **different model fixture**:
cold visits 204/2004/20004 and warm 103/1003/10003 become 10 in all six cases.
Run its pinned `cargo test --locked -p lexical_model --all-features --lib model_caches -j2 -- --nocapture`;
all exact owning commands are in H1. Do not mix its denominator with PROBE.

H2/H3 real-surface follow-up: splice 51/501/5001 becomes 1/1/1; diff
102/1002/10002 becomes 52/502/5002: N+2, the N+1 root payload plus a
one-key list. The probe does not distinguish root from other children; the
extra one-key lists in diff and splice have no measured root/other attribution.
This rerun uses the same PROBE fixture with the runtime hunks applied, then
reverted with the source hash restored.
At runtime checkpoint `8636f7a`, model unit counters show root diff keys N+1,
previous-order reads 2, splice root keys 0 and splice steps 1. H23 binds the
review chain and before/after logs. Follow-up review was still open at handoff;
full suites were not rerun after the `348aed9` test split. No candidate inclusion,
CPU or latency benefit follows from this source proof alone.

### WASM size, raw and brotli by concern

SIZE measures preview 047b total **9526725 raw bytes / 2151522 brotli q11 bytes**.
The stripped candidate has no names. Attribution uses a names-bearing pre-bindgen,
pre-wasm-opt proxy, grouped-body brotli q9 scaled to the candidate: **estimates
±20%, not measured candidate per-crate sizes**. The producer is unattributed.
The retained total-size command is
`node /home/wolf/tmp/wasm-size/br.mjs PINNED_WASM`: raw byte length and
Node zlib brotli quality 11, window 24. `attr.py PINNED_NAMED_PROXY` is the
names attribution harness; it writes hardcoded scratch outputs and must be
copied/retargeted before reuse. Scripts/logs/candidate copy are in
`/home/wolf/tmp/wasm-size/`; preserve REPORT.md,
STRUCTURAL-SPLIT.md and build-s1/build-s5 logs with their own profiles. Later
rounded structural estimates are not new candidate totals. No 50a2 or 5cf
size measurement is established in this ledger.

| Concern (proxy) | Raw | Estimated brotli |
| --- | --- | --- |
| Loro + projection | 1.52 MB | 435 KB |
| serde | 0.74 MB | 140 KB |
| regex stack | 0.42 MB | 118 KB |
| hash maps | 0.39 MB | 55 KB |
| regress | 0.24 MB | 54 KB |
| slice sorting | 0.37 MB | 54 KB |
| markdown / HTML | 0.24 MB | 74 KB |
| fmt / panic / demangle | 0.17 MB | 38 KB |
| URL / IDNA | 0.04 MB | 15 KB |
| remainder | 5.06 MB | 1.08 MB |

These report buckets are proxy attribution, not an additive exact partition of
the final module. For a new measurement, retain exact output hash and byte count,
brotli version/quality, feature flags, toolchain, optimizer passes and names/CODE
mapping. A JSON-data trim is not automatically a WASM, brotli or heap saving.

### Local /health and WebSocket 101

ENV binds sequential Node fetches inside the same sync-service container to
localhost:8787 `/health`, body consumed, 25-second timeout, five before and five
after a local collector network attachment. Its `ws-open-control.mjs` records
CDP handshake-response minus request timestamps for three actual app WebSockets
after fresh navigation. This is not document-open time or an ON/OFF experiment.
The browser invocation is `node ws-open-control.mjs` from its configured owned
producer; it embeds historical config paths and must be retargeted. The health
fetch measurements are retained, but an independently reusable health-script
command is not bound in ENV: that reproduction detail is a gap, not a new command
inferred from the results. Exact network command, script hashes and environment timestamps are in ENV;
network changes require their own authorization, not this reproduction note.

Gotcha: the existing collector had the `otel-collector` alias on another network,
but was not attached to the sync-service network; the alias was unavailable there. The
configured HTTP:4318 telemetry path reached an installed KJ DNS cleanup path
joining a blocking getaddrinfo thread. All 696 retained DNS error log lines named that
host; these are not 696 unique lookups or requests; the network intervention supports causality, not a precise request CPU
fraction. Attaching the existing collector avoided restarting services. Do not
recreate the shared collector with a stack launcher. These Docker/Wrangler
findings are not deployed production network measurements.
The three WS records retain a `/connect` match but not the exact document query
or native receiver association; no target-specific native latency claim is valid.

## Results by candidate

All numbers below are diagnostics. `—` means no bound measurement. Dates are UTC.
See the evidence registry for complete paths and SHA-256s. Cross-row subtraction
is not a matched causal experiment.

| Candidate / date | First Enter OFF → ON ms (Chrome) | keyDown CPU / wall | Paste | Bind / fixed work / H probes | Size raw / brotli | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 0395 / 3b, 2026-11-12 | p50 60.20 → 92.90; ratio 1.543 [1.268,2.267]. p95 149.875 → 220.80; 1.473 [1.102,2.246] | Marked 24.078 / 52.678 ms; lazy compile 12.830 ms CPU, 459 indices | Historical baseline median 2412.25 ms | LOCAL callbacks 12/20/24; PROBE baseline on 3b source plus scratch patch, not the 0395 WASM | — | ENTER3, FUNCTIONS, LOCAL, PROBE, PASTE |
| 4ddec / 3488 preview, 2026-11-12 | p50 68.60 → 112.25; 1.636 [1.155,2.188]. p95 205.15 → 261.75; 1.276 [1.147,2.098] | Single marked 22.803 / 33.978 ms; actual clipboard calls 0 | — | — | 9526725 / 2151522 B (q11) | ENTER4, PHASE4, SIZE |
| 50a2 production, 2026-11-12 | p50 25.60 → 37.10; 1.449 [1.404,1.512]. p95 29.10 → 77.20; 2.653 [1.423,5.484] | — | — | 80d absent; no bound counter run | — | ENTER50 |
| 5cf / d732, 2026-11-12 | — | — | — | Each of six rows: 23 with_txn; Map/Insert/Delete 19/3/1; selected clone attempts/returns 50/50; 80d absent | — | FIXED |
| 80d isolated kernel, 2026-11-12 | — | — | — | 5000p mean bind 50.2433 → 47.8329 ms; ratio .9520 [.9152,.9858]. 100/1000p CIs include 1 | — | BIND |
| Historical d1fca7a8 / e622, 2026-11-12 | — | — | 2294.70 ms vs 2412.25 baseline; descriptive ratio .9513, n=2/arm, no CI | — | — | PASTE |
| H1 ecd5 / H23 source checkpoints, 2026-11-12 | — | — | — | H1 visits 10 all six; H2 1/1/1; H3 52/502/5002 (only H1 uses a different fixture; H23 uses PROBE) | — | H1, H23 |
| Local environment attachment, 2026-11-12 | — | — | — | /health median 3484.090 → 3.824 ms, n=5 each; after app WS 101: 39.247/60.511/13.569 ms | — | ENV |

Timing02 Firefox (same 0395 epoch): p50 OFF 306 / ON 291.5 ms,
ratio .953 [.647,1.539]; p95 653 / 1080.25 ms, 1.654 [.524,3.052].
The wide intervals do not establish Firefox parity. Each browser has n=16/arm.
Chrome native is slower in the three recorded timing datasets; no favorable
rerun replaces them. None is a full plugin, S4 or presentation acceptance result.

## Evidence registry

Paths are retained local evidence. Hashes bind the exact receipt/report version;
its nested manifest binds raw rows, scripts, tools, artifacts and audits. Copy
these files and their referenced assets together when moving the ledger.

- **ENTER3**: `/home/wolf/tmp/lexical-port/editor-perf/production-enter-0395-01/timing-02/raw.json`
  SHA-256 `3b95e84e75e5bfbf0971ee486c4aa5aa6321adb393d7211b48e3e240f34adcfd`.
- **FUNCTIONS**: `/home/wolf/tmp/lexical-port/editor-perf/production-enter-0395-01/keydown-function-final-audit.json`
  SHA-256 `f106b21d4fc6c836cab55ea60fff98e998096bf753f7d260a942ad6286dad742`.
- **ENTER4**: `/home/wolf/tmp/lexical-port/editor-perf/production-enter-4ddec-01/final-diagnostic-receipt.json`
  SHA-256 `f192e1b815a566e5daf2d73c8bee015997297ebe7bd0c0b6f5f1b52f658f4586`.
- **PHASE4**: `/home/wolf/tmp/lexical-port/editor-perf/production-enter-4ddec-01/phase-final-handoff.json`
  SHA-256 `30043dd6d32522f7aac04669033b29d23c878cc89828e8a46be4def77e1ad5be`.
- **ENTER50**: `/home/wolf/tmp/lexical-port/editor-perf/production-enter-50a2-01/final-diagnostic-receipt.json`
  SHA-256 `65198fc20a9a4cd85490317a870c72259708fa741b2bd5081777156ee4a39466`.
- **BIND**: `/home/wolf/tmp/lexical-port/editor-perf/cold-bind-01/final-qualified-receipt.json`
  SHA-256 `7f67847dc2a9596d17cf5c1a9e136c064c850e354fa26eeb52bcf21fbedaa5c4`.
- **LOCAL**: `/home/wolf/tmp/silky-profile/loro-local-commit-work-01/diagnostic-handoff.json`
  SHA-256 `368039bcbbc97d6d9071101d525d682f84e94205cd72ccbd23207a9ce4e577c5`.
- **FIXED**: `/home/wolf/tmp/silky-profile/loro-fixed-work-current-01/diagnostic-handoff.json`
  SHA-256 `7af149065ab777c7f63a5056a00016f24242a5adca03b847ccd55e9b4ccf925e`.
- **PROBE**: `/home/wolf/tmp/enter-first-cost/RESULT-slot30.txt`
  SHA-256 `25bff2d5138cd24efd8e0688d4cad1dad026726553928630973e359ac1394a51`.
- **H1**: `/home/wolf/tmp/silky-profile/root-text-cache-proof/h1-source-handoff.json`
  SHA-256 `ac8fca53fe086b82dd6476bd17140924af2e973bac59417b105dc0b877e616cc`.
- **H23**: `/home/wolf/tmp/enter-first-cost/RECEIPT-H3-H2.md`
  SHA-256 `cb522d937b67e9ba8b3388311d3c0889618dfa051235ecb77295c510c28fa9ca`.
- **PASTE**: `/home/wolf/tmp/silky-profile/paste-static-0395-regress-04/historical-paste-handoff.json`
  SHA-256 `31e26ae5fb7df8e929ee579a8fa269001ebe1210eae00d1fdd5bfddb66a53f46`.
- **SIZE**: `/home/wolf/tmp/wasm-size/REPORT.md`
  SHA-256 `341b2750c06c777743a0fcd70c37d873bda0e804c2d21485288ab0adbd1f3def`.
- **SPLIT**: `/home/wolf/tmp/wasm-size/STRUCTURAL-SPLIT.md`
  SHA-256 `2c3d8fa3e419af693c85577754522067085196dc1ef4d1c5b6f425be78bb62e0`.
- **ENV**: `/home/wolf/tmp/silky-profile/ws101-local-latency-01/environment-change-handoff-v2.json`
  SHA-256 `a1ba1853bd4e6e20ef0585f5df53ee03494ba3bfcb45079fb58d4d33dfdf7b42`.

## Add a candidate row

1. Freeze full frontend/native commits, generated package and actual loaded asset
   hashes. Record feature flags, DEV/PROD, search writer, debug probes, optimizer,
   toolchain, pristine compiled dependencies and auxiliary-engine closure. Do not
   infer a production profile from a production JavaScript build alone.
2. Select the metric's exact existing harness and literal fixture. Record node
   and paragraph counts separately, endpoint/brackets, cold or warm state,
   correctness controls, sample size, statistic, CI method and environment epoch.
   Seal changes to admission or load rules before sampling; never retrospectively
   tune them for favorable numbers. Preserve failed and rejected attempts.
3. Independently verify raw rows, exact outputs and statistics. Record UTC date,
   full evidence path and SHA-256, raw-data/audit hashes and qualifications.
   Counters, wall time, thread CPU, retained heap and serialized bytes are separate
   measurements. For ON/OFF keep the same bundle and audited engine flip.
4. Append one candidate row and registry entries. Leave unmeasured cells blank
   with `—`; do not inherit prior measurements because source looks similar.
   A source fix not present in the candidate gets no candidate credit. Keep
   historical rows immutable and distinguish whole-candidate from isolated-leaf
   effects. Review the updated facts with the owning metric producer before
   adding the documentation commit to the integration branch.
