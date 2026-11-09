# Rust editor integration: production compatibility checkpoint

## Current integrated checkpoint

Source freeze `68329003951f1ef0e004ac78fdda6fee66ab6a1a` is committed and the
native-only preview is installed. Its tracked tree exactly matches the audited
private validation tree `bdef18638ce7bd9b5ffa3033c899b514f472352a`; failed private
root-export attempts and their revert were excluded from integration history.
No dependency directory, preview server process or compatibility selector changed.

The batch includes native Reconcile/admission and retired records, the publication
queue with its required bootstrap follow-up, the frozen slash adapter, clipboard
fixture and guarded snippet command, ten file-paste and four sequential-snippet
contracts, and the bounded replacement/registry/JSON/root-import/DOM-helper source
chain. The actual generated compatibility declarations now expose Batch,
CaptureLeases and TakePublications from the separate explicit compatibility build.
The seven-exception tooling is present without enabling the held full-package CI
hook. Later snippet-resolution, savepoint and plugin-manifest producers are excluded.

Current combined adapter tests pass 96/96 and native-only adapter tests pass 22/22.
Replay passes all 1,421 cases and flat-diff passes 2/2. The publication regression
captures the actual observer commits before drain and compares every wire receipt
in FIFO order, including dirty intent, tags and selection. The integrated history
path produces a tree-removal receipt followed by a selection-clear receipt; neither
is dropped or coalesced. Exact two-descendant removal and the last-version snapshot
fence remain asserted. The earlier one-receipt expectation failure is retained as
failed evidence, superseded by the strict observer-chain regression.

The private workspace rust-check, clippy, format and hakari sequence completed in
order at nice 19 / two Cargo jobs; formatting changed no source. Earlier component
checks passed 521 model tests, the complete Macro package including its 20,000-step
service oracle, 59 native application session tests plus telemetry, seven FFI tests,
27 JVM tests and instrumentation compilation. Those logs retain their exact source
scope. The final source passes strict shim types and 41 hooks from 489 sources,
263 view tests and view types, full app checking and its normal production build,
nine feature graphs, scoped checks, and 18 keyboard/history cases in Chromium,
Firefox and WebKit. The existing DOM-import complexity warning remains visible.
The earlier same-JS-source shim suite remains 326/327: the unchanged 2,396 read
crossings failure is open, not waived.

The final-source native build has SHA256
`e36ecb14f26f48ac544fd908fc154889b4b91e4b931b66d7a13c89c88cbdad9f`,
8,436,344 raw / 1,915,872 Brotli bytes: 1,900 Brotli bytes above the preceding
preview and 315,872 above the advisory ceiling. Native export inspection passes
with compatibility disabled; glue and native declarations remain unchanged. The
separate explicit compatibility artifact was initialized and export-checked with
its exact generated declarations, but was not installed. No latency improvement,
full initializer, namespace, GC, plugin ownership or compatibility acceptance is
inferred from these source and component checks.

The installed preview passes five isolated-browser flows from fresh authentication:
existing document, new document, typing, undo/redo and fresh sign-in. Both redo
shortcuts preserve exact raw JSON, durable IDs and model/DOM caret. All four fetched
WASM responses match the installed hash and no page errors occurred. The first run
used an expired saved access token and failed with API 401s and refresh HTTP 500s;
that run is retained separately. Fresh real UI sign-in restored access on the same
installed artifact. The refresh failure remains an authentication recovery issue,
not a passing check or an artifact regression attribution.

Evidence uses `/home/wolf/tmp/integration3-acceptance/next-union-*` and
`next-batch-*`. The workspace, web and main tree-equality receipts remain separate;
`next-union-preview-install.json` records the complete previous-set backup and
`next-union-live-hash-proof.json` binds the successful fresh-authentication run.
End-to-end trace connectivity and the earlier comment-button/table-picker parity
gaps remain open. Integration3 is not accepted by this checkpoint.

## Previous native preview checkpoint

Source freeze `cafc3c1f80da8c92778e0b9e9a02da2d11c741ea` is built and installed
with compatibility disabled. The artifact-only update preserves matching glue and
declarations; no live dependency directories or server processes were changed.
The isolated browser passed sign-in, existing document, new document, typing and
undo/redo. Both redo shortcuts restore exact raw JSON, durable subtree IDs and
model/DOM caret positions. All four fetched WASM responses match SHA256
`badfaa20badd88e28d7ccd17c3022b8d2eb1c8930e1528360e931ee4f26c2231`.
No page errors occurred. The subsequent infrastructure recovery restored the
analytics proxy's network attachment, and the recovery check verified HTTP 200
from `/i/otlp/v1/traces`. Earlier telemetry 502 responses remain in the raw browser
network list, alongside GitHub-link status 404 and navigation-aborted requests.
End-to-end trace connectivity has not been revalidated.

This freeze integrates:

- FFI ModelSegmentation `45d44144af` as `5ce32e1aa3`, with the explicit pure
  Unicode feature, exhaustive appended mirror tag and matching native bindings.
- Remote typed-state preservation `4a64ac6333` as `b4eec6d20b`, retaining the
  current shared-state configuration path. Ordinary JSON fast import explicitly
  reparses; only raw remote updates retain an unchanged serialized typed value.
- Provider replacement `3136d12239` as `870bd3cc8d` and native physical shortcut
  plus exact history fixture `14c52649e0` as `70fb4a620d`.
- Compact batch/reserved construction/recovery/scoped metadata and exact capture
  prerequisites through `3386e98687` as `5d1f672778`, plus the empty registry
  residual `dc972f4bd4` as `dc59d1db25`. Unsupported admission/selection intents
  still reject; this is not a complete compatibility initializer.
- Pipeline prerequisite `ec39fe9bef` as `f7b9095e10`, then generic staging
  `4f269b9334` as `cafc3c1f80`. The prior staging validation union passed its four
  workspace gates; its receipt remains separately bound. Current freeze gates
  run independently.

Current freeze tests pass: 517 model, 85 WASM adapter, 59 native application
session plus telemetry, 61 all-feature session plus telemetry, seven FFI,
1,421 unchanged replay and two flat-diff tests. Matching binding freshness,
26 JVM tests with zero failures/errors/skips, instrumentation compilation,
schema freshness, nine feature graphs and scoped checks pass. The new native
artifact passed 263 view tests and 18 keyboard/history cases across Chromium,
Firefox and WebKit. The production web build passed with the usual optimizations
and a 12 GiB Node heap. The current full workspace rust-check, clippy, format
and hakari sequence passed in order at nice 19 / two Cargo jobs, without source
changes from formatting. The initial rust-check stopped on missing private SDK
dependencies; a frozen private SDK install repaired the environment before the
whole ordered sequence restarted. That failed attempt remains preserved. The
current receipt is `cafc-workspace-green-receipt.json`; later collector additions
change no Rust or native recipe inputs and have their separate bounded checks.

Size is 8,421,630 raw / 1,913,972 Brotli bytes, 2,009 Brotli bytes above the prior
native artifact and 313,972 above the advisory ceiling. Actual export inspection
finds createMacro and no compatibility exports. Glue and declarations are byte
identical to the prior native set. No new latency or full compatibility acceptance
is inferred. External evidence uses the `cafc-freeze-*`, `cafc-native-*` and
`cafc-live-*` prefixes; `cafc-preview-install.json` records the previous-set backup.

## Bounded collector source integration

After core-owner adoption, collector `c026d6341d` / native state proof
`84b55162e4` / shared capture owners `bfe81636ed` are integrated as
`cda7027af2` / `f036345a56` / `c5e713e659`. Minimal dependencies are the existing
scalar values, exact CapturedRecords, acknowledged CaptureLeases with local
ownership lookup, diagnostic measurement glue/runtime, and the sole NodeHandles
lifetime port `6054f87488`. No production backend body or initializer was installed.
These additions change no Rust, native build recipe or shipping WASM inputs.

Independent validation passes 26 component tests, 12 real native lifetime/GC
cases, 28 measurement tests, strict actual-artifact type checking, ordinary
external declaration emission and scoped checks. The native cases preserve their
exact `3386e98687` source/artifact pin (WASM `395a7da5`), not the CAF preview.

The host instrumentation check is a new qualified source-overlay proof: unchanged
historical host file SHA `90e824ec` and body `564fa631`, actual CAF compiler config,
TypeScript 6.0.3 and actual generated a50 schema. The original on-disk host remains
unchanged; TypeScript's readFile overlay receives the transformed virtual input
SHA `89b9b80e`. The provenance labels that virtual source separately and rehashes
the other disk inputs. Earlier missing-host/config and declaration-output-layout
attempts remain retained failures; final results use complete actual inputs and
an explicit external root/output layout, without source projection or stubs.

The proof is bounded to components and real native acknowledgements/finalizers.
Full backend installation, namespace acceptance, full Macro GC/performance and
the compatibility initializer remain open. Evidence uses `collector-chain-*`,
including separate native raw proof and host-overlay provenance.

## Disk-full recovery evidence

The initial post-outage check failed at authentication (HTTP 500 identity-provider
lookup and refresh), then the next check passed sign-in while documents remained
on skeletons. After the infrastructure DNS/alias repair, the prior native set
passed all five checks; the newly installed set independently passes them too.
The earlier failures remain in `preview-recovery-results.json` and
`preview-recovery-repaired-results.json`; final recovery is recorded separately
in `preview-recovery-final-results.json`. None was trimmed or relabeled.

Per-run IPv4/IPv6 bridges for ports 24009/24010 use isolated DNS/network/PID state.
The initial missing-socket harness failure never opened a browser. No stack or
authentication data changes were made for these checks.

Critical prior build/browser outputs completed before the disk-full event. The
post-restart rehash verified all 11 archived native/compat files and five installed
files unchanged. Partial disk-window outputs were invalidated. The subsequent
Linux dependency-hash rebuild completed exit zero with its declared hash unchanged;
Darwin verification is unavailable on this Linux host. Only explicitly owned stale
scratch paths were removed after sealing archives, without touching live
dependencies, stack volumes or other targets.

## Historical source/artifact checkpoint: native feature isolation

The native compiled-feature 5% comparison is superseded. Production native,
FFI, server/headless and current native web builds exclude compatibility and
foreign nodes by construction. The compatibility web host still needs the real
full-plugin user-facing gates against upstream: typing p95, paste, bulk JSON and
Markdown, boot/document-open, crossings, bytes and captures. Earlier feature-on/off
measurements remain diagnostic; they are not an acceptance gate or waiver.

Clean source freeze `272ef7d989b500ac78a9965eb77eb886a07859f7` contains:

- Codec `43606cfea0` / raw-alignment `ff007411a2` / raw consumer `fabd4f6816`,
  integrated as `17b31962ca` / `be6697e3c7` / `081ab765f0`. Public serializedState
  and cold query 7 use the canonical model writer; savedState, FFI and ABI/schema
  are unchanged. Browser bulk ratios and JSON trace connectivity are unverified.
- Cargo opt-in `ab0b9cc166` as `8330578a54` and FFI entries `10936f2727` as
  `ae4133a0e6`. Defaults retain owned wire types only; `compat-web` is explicit.
- Recipe/CI enforcement `272ef7d989`: eight actual production normal/build
  dependency graphs reject session compatibility and model foreign nodes;
  explicit compatibility-web is the positive control. Generated lexical/session
  jobs run the guard before compilation. Native cached/desktop outputs also
  validate actual exports. Native `wasm/` and compatibility `wasm-compat/` have
  separate Cargo targets, feature-aware cache commands, glue and declarations.

Local source checks pass: 498 model tests, 66 all-feature WASM tests, 22 native-only
WASM tests, six guard tests, nine actual graph checks, workflow guard-order test,
workflow generation freshness, dependency metadata, Nix expression parsing,
scoped checks, TypeScript and strict model/WASM/workflow Clippy. An inherited
workflow test PATH accessor was corrected without deployment-logic changes;
its five mocked-script tests pass. No workflow dispatch or deploy occurred.

The independent native-only source build from this freeze produced 8,411,202 raw /
1,911,963 Brotli bytes, SHA256:
`1a8200b918dd513a3f8977b6994d17308fc7b3cc6d06ca1491c76be0ee080156`.
It has no compatibility exports, JS class methods or native declaration stubs.
The previous actual `868826f5` compatibility artifact is rejected by the native
export guard. Native output is 168,989 Brotli bytes smaller than that preceding
installed build; this aggregate comparison includes codec and feature changes.
The advisory ceiling is still exceeded by 311,963 bytes; no new speed/startup
acceptance follows from size or feature isolation.

The native artifact is installed in the local preview with its own matching glue
and declarations. App/view types, 263 view tests and 18 three-engine keyboard
cases pass. The isolated live browser fetched the exact new WASM and passed code
input plus both redo shortcuts with exact raw JSON, durable IDs and model/DOM
caret restoration, with no page errors. No dependency-cache writes or stack
restart occurred. The separate producer rebuild reported the identical WASM and
glue hashes; only this integration build was promoted.

The explicit compatibility package also built and initialized successfully in
its own output: 9,230,011 raw / 2,082,807 Brotli bytes, SHA256:
`a0527f87643d7cd1d14eb18e154fc26c0c2ddb37f64f0ebb5f2b3f352cb90489`.
It exposes the actual protocol-1 / schema-52e compatibility methods and remains
unpromoted. Its exact generated declarations (SHA256 `222e711dac3d0af63317eedb8c8a4420c83187874f6ffd8361e231b1e5c50f85`)
are type-only exported as `@macro-inc/collaboration/session/wasm-compat` in
`6b5210e4fc`; native declarations are separately regenerated in `54e65da15f`.
The isolated package-only handoff is `92d1eed740`, with no app recipe or readiness
files. Neither output proves an initializer or the newer queued batch/lease API.

Package type checking caught an older five-argument keyboard call in the portable
history fixture. `3f4fa2db3d` passes its real latest native range through the
current twelve-argument primitive; assertions and history policy are unchanged.
Collaboration types and all three actual portable history browser cases pass.
Actual package-export type proof confirms native has no compatibility methods,
while the separate generated compatibility class does. The web production bundle
passes with the same 12 GB build heap used previously; no optimization was relaxed.
The Linux node-modules fixed-output verification was interrupted during the
disk-full/restart window. Its subsequent isolated Linux Nix rebuild after the
type-only manifest export completed exit zero with the declared hash unchanged.
Darwin verification remains unavailable on this Linux host and is not claimed green.

Evidence under `/home/wolf/tmp/integration3-acceptance/` includes
`native-profile-artifact-manifest.json`, `compat-profile-artifact-manifest.json`,
`native-compat-module-shapes.json`, `native-profile-final-graphs.log`,
`native-profile-three-engine.json`, `native-profile-preview-install.json`,
`preview-native-profile-installed-results.json`,
`preview-native-profile-snapshots.json`, `native-profile-web-build.log`,
`native-profile-portable-history-browser.log` and
`native-feature-isolation-source-audit.md`.

Table-picker/comment-button gaps, full compatibility/initializer/parity and
Android device/app-surface acceptance remain open. The separate full-preset root
metadata missing-to-null redo issue was pending at this older checkpoint; the
current CAF metadata/JNI follow-up above passes its strict history controls.
Generic staging, capture-consumer and metadata results are bound to the later
freeze, not folded into this historical artifact proof.
Integration 3 remains unchecked.

## Prior checkpoint: stable subtree identities and Android prerequisites

Stable-ID fix `67611c311e` is integrated as `4d18067f62`: default session and
application identity plugins now treat only attached competing owners as
duplicates. Conflict resolution retained the current session builder, input,
handled-command and initialization behavior; no absent-parent imported-ID policy
was added. The real session regressions preserve full raw JSON and caret through
two code-subtree redo cycles while still repairing attached duplicates.

The exact 21-commit Android prerequisite chain is integrated, including the
`ddb3b1345e` watcher fix, followed by Raw FFI correction `c70f842b8d` and renderless
provider follow-ups `1e963eb27d` / `1d5ed26a55`. Main source tip is `ac3ea6804a`;
`ad8b6ed445` adds the strict code-subtree keyboard regression and package guidance.
No application surface mounting was enabled. Android registration is platform
scoped; the client retains the cached feature gate. Shared generated Swift/Kotlin
bindings remain paired; no iOS app, release, signing or store files changed.
The duplicate size-policy and core foundation ports were skipped.

Independent build source `d1e4c25c6c` has identical native inputs to main
`ac3ea6804a`. The normal six-hot-crate opt3 profile, `wasm-opt -Oz --converge`,
Cargo `-j2` and `/home/wolf/tmp` produced 9,224,118 raw / 2,080,952 Brotli bytes.
WASM SHA256:
`868826f5f50448b9fc8e07cec507191de8226bbc31a23ecf86b43662896014a5`.
The aggregate increase is 15,615 Brotli bytes over the preceding installed build;
this is not a per-change ablation. It exceeds the advisory ceiling by 480,952
bytes. No new startup or latency acceptance is inferred.

Validation passed:

- Three-engine keyboard suite: 18/18, including six native code-subtree cases
  with both redo shortcuts, two cycles, exact raw JSON/durable IDs and model/DOM
  caret at offset 22. No ID normalization or exclusions.
- Combined session suite: 56 tests plus one telemetry test; view TypeScript,
  all-target/all-feature strict session/model Clippy and combined scoped checks. Matching generated WASM declarations are unchanged.
- Android disposable validation: 93 frontend tests in 17 files, another eight
  provider lifetime tests, app TypeScript, final web production build, six FFI
  tests, actual JNI JVM 24/24 with zero skips, instrumentation compilation,
  Android-target strict plugin Clippy, binding/bridge freshness, scoped checks
  and focused OFF mentions Chromium browser regression. The web build used a
  12 GB Node heap after the default heap exhausted memory; optimization settings
  were unchanged. Instrumentation device execution is not claimed.
- Installed live code spot: trusted typing then Ctrl-Z/Ctrl-Shift-Z and
  Ctrl-Z/Ctrl-Y restores exact raw state, durable IDs and model/DOM caret.
  The isolated browser verified the served WASM hash above; no page errors.
  Initial background API 401 responses, optional integration 404 responses
  and aborted background requests remain in the raw network evidence. No dependency-cache writes or stack restart occurred.

Evidence is under `/home/wolf/tmp/integration3-acceptance/`:
`stable-id-three-engine.json`, `stable-id-combined-session-suite.log`,
`stable-id-artifact-manifest.json`, `stable-id-preview-install.json`,
`preview-stable-id-installed-results.json`, `preview-stable-id-snapshots.json`
and `preview-stable-id-installed-code.png`. The source and Android audits are
`stable-id-integration-audit.md` and `android-prerequisite-integration-audit.md`.

The previous live raw-ID redo failure is closed. The table picker and comment
button remain earlier OPEN acceptance gaps; they were not relabeled as passes.
Production compatibility/selector admission, Android app surface admission,
device/APK acceptance, full parity and Integration 3 remain unchecked.

Current calibrated compatibility timing does not pass the 5% gate: S ratio
1.04672 [1.02331, 1.07067] is inconclusive; M 1.07568 [1.05361, 1.09821] and
L 1.08915 [1.05958, 1.11954] exceed the limit. Retain `eda` as an audited partial
improvement. TLS follow-up `7502076f01` is queued separately and requires a fresh
matched measurement; it is not included in this frozen preview artifact.

## Prior checkpoint: routed keyboard history and combined source build

Keyboard history fix 87163f3a57 is integrated as ae9b506f1f. The existing
integration handled-command metadata is retained in the shared history method
by 61a842a479: its literal failed before and passes after (2/2). The listener-first,
commit-before-navigation policy remains intact; no JavaScript bypass or ABI
change was introduced. Native lifecycle prerequisites are integrated as
e5cdd413d2 / bcef915f27 / b073fd8004, and sparse payload validation as 2a9b28956a.
The newer 52e schema was preserved. The JS batch driver is integrated as 87ed78ea71;
its 7 protocol tests and types/hooks/scoped checks pass; full shim 241/242 retains
the known 2,396-crossing failure. Actual consumer/initializer wiring is absent.
Normalization may report actual no-op retirement; the backend must apply
sidecars/leases and retire from that flag, never infer retirement from unchanged.

An independent combined source build at e9ca2e89f5 matches main native inputs at
2a9b28956a. Normal profile/six hot opt3 crates/wasm-opt -Oz --converge, Cargo-j2,
and the specified TMPDIR produced 9,149,457 raw / 2,065,337 Brotli bytes. WASM SHA256:
`adc4e7b5e3dbd9ce38e8a3b9d69e9ad4cf94ed121c64de6ead3f8fae2d159522`.
This is 21,303 Brotli bytes above the previous combined build and 465,337 above the
advisory ceiling. These aggregate changes are not a per-change size ablation.
Matched feature-on/off timing and strict startup/open performance gates remain
pending. The owner artifact was not promoted. Matching generated declarations
are committed as 937f54b55c; browser regression/guide/config as e051b32924.

Both native and upstream history tests load the same real initial state and clear
their real histories. Chromium, Firefox and Linux WebKit pass 12/12 static cases:
trusted typing, Ctrl-Z, Ctrl-Shift-Z and Ctrl-Y with exact model JSON and model/DOM
caret restoration. The previous artifact with the SAME corrected fixture passes
six upstream controls and fails six native undo cases. Early multi-character
history-grouping and unequal native-empty/source-paragraph fixtures are retained
as diagnostics, excluded from this acceptance. Linux WebKit is an engine proxy,
not Safari qualification.

The source-matched build is installed in the local preview. Live code typing,
undo and redo change/restore text and restore both model and DOM caret exactly.
The stronger live full-JSON comparison is RED: deleting/recreating a code subtree
changes its text leaf `$id` (5 to 8), while the code ID is preserved. The native
owner has the raw snapshots and is investigating identity tracking. No ID mask
or acceptance waiver was applied. Table-picker and Comment-button gaps remain
OPEN. Full parity and Integration3 remain unchecked.

Own combined checks pass 485 model, 56 session plus telemetry, 65 WASM-adapter and 46
projection tests; all 1,421 replay harness checks (1,367 actual passes + 54 expected
ledger outcomes, 452 actual Macro passes), flat-diff 2/2, strict three-crate Clippy,
view/app types and scoped check. The raw hosted lifecycle smoke uses the actual
pinned 0.45 class and this rebuilt artifact: one Root clone, retained source,
null root cache. It is not full hosted initialization or derived-cache acceptance.

Evidence under `/home/wolf/tmp/integration3-acceptance` includes
`routed-history-{build-freeze,artifact-manifest,preview-install}.json`,
`routed-history-static-three-engine.json`,
`history-keyboard-loaded-state-old-control.json`,
`routed-history-combined-{native-tests,replay,clippy,scoped-check}.log`,
`hosted-lifecycle-source-matched-smoke.log` and
`preview-routed-history-first-snapshots.json`. Live acceptance is not green.

## Previous checkpoint: native view/history preview and notification correction

The LIVE native-view O(edit) chain is integrated as 0f754d883f, 7b875ec594,
af7fd810ae, 07b29bd983 and 956002830c. History-selection fix c9282eaa41 is
integrated as 336b3700de, preserving newer TextDelta input/feedback branches.
The original flag-OFF MarkdownEditor and legacy comment-layout body are byte
identical to the pre-view source; no OFF browser rerun is inferred from that.

A combined source build in the independent validation checkout 6119d8731f
produced ABI 2 / Diff 1 WASM SHA256
`d1d6c4a930bad81b1f3154a375c010daf42951389348a54e91c7efe8d65df860`:
9,072,146 raw bytes / 2,044,034 Brotli bytes. This exceeds the 1,600,000-byte
advisory ceiling by 444,034 bytes; startup/open strict latency gates remain
unmeasured. The normal document-session-wasm profile, six hot caller crates at
opt3 and wasm-opt -Oz --converge were used with two Cargo jobs. Matching generated
declarations are committed as 9dc6a842ec. The candidate was briefly rolled back
after a blank-shell report, then reinstalled after controlled old/new comparison.
Blank-shell diagnostics observed host network churn; corrected private controls
subsequently opened both old and new builds. Early isolated skeleton runs
were invalidated by a harness proxy-log backpressure bug and an unbridged HMR
port; corrected private IPv4/IPv6 bridges cover ports 24009 and 24010 and drain
logs continuously. No dependency writes or stack restart occurred.

The installed-browser rerun independently fetched the exact WASM hash above.
Both old and new builds open synthetic documents and render/type code without
JavaScript errors. The following were OPEN in both exact controls at that checkpoint:

| Interaction | Installed build | Old build |
| --- | --- | --- |
| Open and type code | pass | pass |
| Ctrl-Z changes typed code | fail: unchanged | same failure |
| `/table` picker | absent | absent |
| Comment button after text selection | absent | absent |

At that checkpoint redo was blocked behind the failed undo assertion. The later
routed-history and CAF checks close that keyboard failure; table/comment UI
coverage remains open. The historical failures are retained acceptance observations,
not passes or new regressions attributed to this batch. The new build is installed
for local preview with those gaps retained. No full parity acceptance is claimed.
Evidence: `preview-live-view-history-{installed,old-exact-spots}-results.json`,
matching screenshots/logs and `live-view-history-preview-authorized-install.json`.
The invalid premature `/app/component/loading` reload controls and incomplete
bridge diagnostics remain excluded from passing evidence.

Independent checks pass 482 model, 54 session, 46 projection, 5 targeted undo
simulator, 263 view and 51 app-comment tests; package/app types, scoped check,
dependency metadata and strict model/session Clippy pass. Work-counter browser
cases pass in Chromium, Firefox and Linux WebKit: S8/L128 anchor reads 1/1,
table attribute writes 0/0 and equal positive code-range work. These are component
correctness/counter checks, not whole-editor latency or Safari qualification.

Full private Chromium native-view tests are 49 passed / 1 failed of 50. The strict
large-HTML raw-DOM comparison remains RED while model/Markdown pass. A controlled
pre-view JS source 46c54f1060 with the SAME new WASM fails identically: the native
DOM and upstream DOM are each byte-identical across old/current view. The mismatch
is 166 empty class attributes, 166 empty style attributes and 166 data-lexical-key
attributes. No comparator mask, allowlist or rebaseline was introduced. This
isolates the view-chain regression question, not an old-binary baseline.

The JS command registry/root bindings and lazy-batch schema are also integrated;
command/registry.ts now consumes the central commandBucket helper. The public
updating flag was incorrect during update listeners/deferred notifications. The
actual parent-command reproduction failed before correction and matches its
unchanged upstream control after a7e71dcbc1 (integrated as a85e3d1455). Exact
reproduction plus command/update tests pass 15/15; full shim tests pass 234/235,
with only the unchanged 2,396 native-crossing assertion failing. Full TypeScript 6
and 41 hooks / 489 sources, plus scoped check pass. No production initializer,
FIFO/native callback, collection-identity or zero-crossing acceptance is claimed.

Evidence is under `/home/wolf/tmp/integration3-acceptance`: the
`live-view-history-*` logs/manifests, controlled
`pre-live-view-same-wasm-html-baseline.json`,
`js-command-parent-phase-{negative,fixed-clean}.log`,
`js-command-notification-{full-tests,package-check,scoped-check}.log` and
`live-view-history-integration-audit.md`. The first baseline path attempt and an
interrupted overlapping diagnostic are retained and excluded from passing proof.
Integration3 and compatibility/parity gates remain unchecked. Replay checkpoints
`a8a44d71f5` and `ac07ec1d4f` are integrated as 8239ca782a and 5037e93b05:
a literal two-editor notification regression and removal of only three obsolete
root-cache exclusions (57 to 54). The stale-unexpected-pass guard is unchanged.
The reported fixture047e1/op20 failure belongs to an older diagnostic checkout;
required captured-getter/snapshot-ownership fixes are already present here.
The integrated replay rerun now passes all 1,421 harness checks: 1,367 actual
passes and 54 expected ledger outcomes, zero failures. Both flat-diff tests pass,
and all 452 Macro fixtures are actual passes. The new
two-editor retained-notification literal also passes, and scoped check passes.
Evidence: `replay-graduated-integration.log`,
`replay-retained-notification-literal.log` and `replay-graduated-scoped-check.log`.
The native owner has confirmed the keyboard-undo dispatch gap and is preparing
a separate fix; the existing direct undo-selection tests do not clear that gap.

## Previous checkpoint: source compatibility and open runtime gates

Static-config module `f5b6913051` is integrated as `2217287f82`, after the six-helper
source prerequisite. Its four exports prepare actual-class getType/clone/JSON/DOM
factories and inherited shared state, plus a consume-once pending clone source.
Default cloning sets the real source before constructing the class; no cleanup
absent from the pinned source was invented. Registry/constructNode authorization,
runtime binding and successful authorized hosted cloning remain open; no editor,
base-node, state or runtime wiring was changed by this module.

Independent static/state/bucket18, focus8, full shim check41/489 and scoped checks
pass. Ordinary full-config declaration emission with output-layout-only rootDir
passes134 declarations, no diagnostics/projection/exclusions. Complete shim tests
are **225 passed /1 failed of226**, still only the2,396-crossing assertion. The
central SIX/hash7f094 remains unchanged. Evidence:
`static-factory-{state-focused-tests,full-shim-check,full-shim-tests,ordinary-declarations,focus-scoped-check}.log`,
`static-factory-source-proof.json` and `static-factory-focus-integration-audit.md`.

Commands/constants `112dbf7cd4` are integrated as `869f53a49f`, followed by the
authorized six-helper/state-core checkpoint `8faf05b48e` as `24d832a49e`.
The central helper SHA256 is now
`7f094707ad04a9a24e0dd4ade0a3685a88637dc4d7ec709accae4d2dac45712e`:
exactly six assertions, one per helper. The new direct product state calls are in
`nodes/state/helpers.ts` and `record.ts`; existing runtime reexports are unchanged.
There is no `command/registry.ts` consumer in this tree yet. That consumer remains
pending; no substitute callsite, factory or runtime binding was added.

Typed per-config state storage preserves opaque values and live known-state reads;
unsupported direct known-state mutation throws. Sparse/wrong-kind command buckets
reject rather than accepting holes. Static preparation, createSharedNodeState,
actual writable/capture/clone/rollback authority and native state acceptance remain
blocked on the real runtime at that checkpoint. The static preparation source is
now supplied above, while actual registry/runtime bindings remain pending.
Commands/constants cold evaluation uses the immutable
upstream source and requires no engine; public root namespace completeness and
dispatch binding are separate gates.

Independent checks pass12 state/bucket tests,4 command/constants tests, command
payload types, full shim TypeScript6.0.3 and41 hooks/489 sources, and scoped
`just check`. At the six-helper checkpoint, shim tests were **219 passed /1 failed of220**: the same
2,396-crossing assertion; broader transform-phase collection identity remains open.
The first full declaration emit stopped on TS5011 output layout. Retrying the
same full tsconfig with only an explicit repository `rootDir` for output emitted129
ordinary declarations with zero diagnostics: no input exclusions, source rewriting,
private projection or semantic-option relaxation. Owner provenance SHA256
`320835f048ff3d44ef160998ec219d267fb9b5a7b4a479d68f3cfaa981dc08c1`
was rechecked; it is source-contract evidence, not native acceptance. Logs:
`state-six-{focused-tests,command-tests,command-types,full-shim-check,full-shim-tests,ordinary-declarations,scoped-check}.log`
and `state-six-source-proof.json` under the acceptance directory. The earlier
TS5011 log remains preserved. Future CI-oracle exception manifests must use the
new helper hash when the held oracle hooks are admitted.

Namespace producer `1420c15381` is integrated as `eb15086988`; current compatibility
schema fingerprint is `2b4d927cf4348931633b31c4d5884ab56832f661537e68fbc27ebdc81739baef`.
Batch host failures retain the original host slot beside the opaque error.
Retirement fence `195cf57177` is integrated as `f41f24f5b5`: never-issued,
current and pending versions reject before release effects; repeated issued,
already-retired versions remain valid empty acknowledgements. The session ABI
stays2. Independent63 native tests, strict Clippy, wasm32 target check, schema freshness, generated
session types and scoped checks pass. This does not establish JS exception-owner
recovery, physical retirement, a hosted factory or artifact readiness. Evidence:
`retirement-fence-{native-tests,clippy,wasm-check}.log`,
`retirement-namespace-{schema-freshness,session-types}.log` and
`fence-checklist-hover-scoped-check.log` under the acceptance directory.

Development metadata `8c894d25ef` / `3008613eb3` is integrated as `6b0c3bdb3a` /
`b14e0ee091`, with compiler guard `ac179e8327` as `f583385cd7`. Actual dirty facts
and raw root-cache reads now survive historical read scopes. Independent native
tests pass115 core and27 conformance-WASM cases; generated host-packet freshness
passes. An initial type check found stale ignored development declarations; only
the disposable development WASM was rebuilt from source, then full shim check
passed TypeScript6.0.3 and41 hooks/489 sources without regenerating hook evidence.

Audit found retained dirty collections could stay stale after transform
registration. The real-WASM diagnostic failed before `29b7a9a6b6` and passed after
its integration as `9099dd64d9`. Registration, command dispatch and flush now use
observed-only refresh. The diagnostic source/hash and red/green logs are preserved
externally; the temporary test was removed before the final whole-suite run.
That run is **207 passed /1 failed of208**, with only the unchanged 2,396-versus-zero
graph-read crossing assertion. The three raw-cache failures and unhandled error
are gone at this epoch. Temporary Set/Map identity across native transform queue
swaps remains an explicit development gap; no unconditional callback refresh or
whole collection-identity parity is claimed. Production backend/initializer and
the mandatory namespace CI hook remain held.

Cold audit schema `b9c11f66c4` is integrated as `1c88853ec2`, with fingerprint
`767306e64a6b74111330f49313e49dc061dc68b2c6bbce1c22b8d37cb55d3760`.
Getter `7d25335051` is integrated as `790ea54abe`: it observes actual capture/node
counts, current version and checked prune epoch without allocating captures or
refreshing publications. Pending/unacknowledged graphs reject; no-pending discard
preserves frozen captures. Native62 tests pass at that checkpoint. This closes
cold native count production only; physical GC/collector and shipping declarations
for the new export remain unvalidated, with no artifact promotion.

Opaque exception transport `24e29fb8a0` is integrated as `b621d46204`. Original
host slot and opaque undefined/null identity travel through the existing model
extension/deferred-read error path; nested acknowledgement sidecars remain intact.
This is typed native transport, not full JS exception/lifetime or hosted-factory
acceptance. The combined consumer run passes50 session,63 session-WASM and46
projection cases. Strict all-target/all-feature consumer Clippy and scoped checks
pass. Logs: `dev-metadata-{native-tests,matched-shim-check,fixed-full-shim-check,fixed-full-shim-tests,host-packet-freshness}.log`,
`dev-metadata-retained-transform-red-green.json`, `cold-audit-native-tests.log`,
`loro-host-error-consumer-tests.log`, `metadata-loro-host-error-consumer-clippy.log`
and `metadata-loro-host-error-final-scoped-check.log` under the acceptance directory.
Audits: `dev-metadata-integration-audit.md` and `cold-retention-audit-integration-audit.md`.

Standalone Loro undo fix `9fa83b060b` is integrated as `72dd7913c9`: an empty
remote row short-circuits before scanning affected containers; nonempty remote
conflict rules are unchanged. Independent vendor undo7/7 and the consumer checks
above pass. Owner hot-loop measurements254.4ms versus Draft-only355.2ms and
original42,380.9ms concern5,000 keys on exact live-source variants, not integration
browser latency or overall performance acceptance. Caret/history and structural
seed28 are not fixed by this change. Broader server/transcript/replay matrix work
remains paused. Evidence: `loro-empty-remote-undo-tests.log` and
`loro-ios-integration-audit.md`.

Sparse native publication `e248a380bf` is integrated as `86382d8abb`, after cold
audit schema `b57818fbaf` (equivalent producer `6f9798e030`) as `781a0e46fd`.
The sparse checkpoint's schema fingerprint was
`24c38b2078bf718c3812f5e0c4d25ee9bbb288845648c291d0eb79df730174eb`.
Ordinary commits send dirty/normalized/mutated records and every removed subtree
descendant; explicit snapshots and actual full reconciles remain full. Hot records
omit root strings. The real-session regression passes equal edit encodings within
4,096 bytes at10 and10,000 paragraphs (21 and20,001 records), not exact10/10,000
nodes or full Macro physical typing. The descendant deletion control also passes.
Independent61 native library tests, strict Clippy, wasm32 target check, schema freshness, session types
and scoped checks pass. Audit count version/retirement-epoch production is the
later cold-getter checkpoint above; schema fields alone do not satisfy retention gates.

View scope prerequisite `db3b35c033` is integrated as `61b4c48bdb`, followed by
derived-cache component `86ff3a10de` as `7f543bd319`. The optional third scope
argument preserves read-only defaults/probes; its producer forwards the complete
adapter signature inside an injected real stage. Exact-instance weak cells retain
root/element values without latest lookup. Reconcile requires Mutable next state
and an authoritative removal delta, but actual stage/lease/field authorities are
not wired. The removal guard applies only through this unwired entrypoint.
Positive projection, stage, copy-on-write, rollback and freeze tests remain
blocked; the component tests do not substitute for them.

Independent value2, view68, full view types and full shim check (TypeScript6.0.3,
41 hooks/489 sources) pass. Value tests cover400 cell reads with zero component
crossings, not the whole-engine zero-crossing gate. Development WASM was rebuilt
only in the disposable checkout; no shipping/live artifact promotion occurred.
Owner33 browser results are portDOM/upstreammodel evidence, not native acceptance.
Logs: `sparse-publication-{integrated-tests,integrated-clippy,wasm-check,schema-freshness,session-types}.log`,
`sparse-derived-stage-scoped-check.log`, `derived-stage-{value-tests,view-focused,view-types,shim-check}.log`
and `sparse-derived-stage-integration-audit.md` under the acceptance directory.

Hydration prerequisite `fb442f1ee3` is integrated as `254168ddbb` after the cache
ownership policy. Compat instance binding preserves an absent root cache, and
snapshot/refresh no longer eagerly requests root-text aggregation. Default native
binding retains derivation. Independent all-feature library tests pass481 model
and60 session-WASM cases, including absent-cache hydration/capture controls;
strict all-target/all-feature Clippy, wasm32 target check and scoped `just check`
pass. This establishes
absence preservation, not the missing exact JS derived-cache producer or hosted
runtime readiness. No ABI change, browser acceptance, shipping build or live
promotion is claimed. Evidence: `compat-hydration-integrated-{tests,clippy}.log`,
`compat-hydration-{wasm-check,scoped-check}.log` and
`compat-hydration-integration-audit.md`.

Cache-ownership prerequisite `7033671fc6` is integrated as `42e6101143`.
The immutable registry defaults to native cache derivation; only compatibility
prevalidation/live builders opt out through `without_reconciler_caches()`.
Normal native/createMacro builders retain root and element cache derivation.
The external reconciler policy preserves explicit raw format/style writes rather
than overwriting JS virtual-setter results. Policy remains in the portable model
builder, with compatibility factory wiring; no transport or authorization changes.

Independent all-feature library tests pass480 model and60 session-WASM cases,
including the new external-versus-native cache control. Strict all-target,
all-feature Clippy, wasm32 target checking, model no-default-feature checking and
scoped `just check` pass. The actual prepublication JS
cache producer, stage/lease handler and virtual-setter acknowledgements remain
unproven activation gates. No hosted initializer, browser acceptance or artifact
promotion is claimed. Evidence: `compat-cache-policy-integrated-{tests,clippy}.log`,
`compat-cache-policy-{wasm-check,no-default-check,scoped-check}.log` and
`compat-cache-policy-integration-audit.md`
under the acceptance directory. The broad workspace/matrix remains paused.

Dirty-child/decorator view checkpoint `f7a774700c` is integrated as `98d30917d4`.
View-only ordered text aggregates and compressed clean-child runs avoid walking
unrelated siblings while preserving DOM-hook and mutation ordering. Ordinary
decorator publication avoids a full scan; actual decorator changes retain the
exact plain-record copy. Native commits must supply authoritative `removedNodes`
for unmounted cleanup. The property remains optional and an omitted delta is
treated as empty, so this contract is not enforced fail-closed; a missing producer
delta can retain unmounted decorators. This is an explicit activation gate, with
no scan fallback or native producer completion claimed. Logarithmic index work
does not bound whole-root string flattening, DOM hooks or changed-decorator copies;
no blanket end-to-end O(edit) or latency claim is made.

Independent disposable checks pass all67 focused tests, full view-package types
and scoped `just check`. Owner evidence reports2,765 immutable upstream unit
passes with one pinned skip,33 browser cases in three engines, unchanged1,880
source hashes and a byte-identical64-step/278-event trace. These are portDOM with
the upstream model, not actual Rust compatibility. The owner unit/browser report
hashes were independently rechecked against its provenance; those larger suites
were not repeated here. Evidence: `dirty-child-integrated-{focused,full-types,check}.log`,
`dirty-child-owner-evidence-rehash.json` and `dirty-child-integration-audit.md`.
Actual root-derived pending-state production, native removal deltas, initializer
and app activation remain open. No live dependency or artifact writes occurred.

Reconciliation producer schema `aae5c5ab2c` is integrated as `577fe4a099`, with
fingerprint `260b600ba0ab014808e9d2aaaafb03ce7c05aed5dcbb0f13b4751fe670163b83`.
HostCall Reconcile uses tag7; ReconcileAck uses tag8, preserving Thrown tag7.
The stage carries exact previous/next versions; its acknowledgement carries
stage identity, capture leases, buffered operations and opaque patches rather
than full root strings. Native transport still rejects this acknowledgement
through the existing wildcard branch: exact stage/lease handling and actual
mutable pending-state wiring remain unimplemented. This is schema-only evidence,
not runtime readiness. Independent generator freshness, generated session types,
all60 all-feature native library tests and scoped checks pass. Evidence:
`reconcile-schema-{freshness,session-types,integrated-native-tests}.log` and
`reconcile-schema-map-scoped-check.log`. Existing archived artifacts retain their
own older schema; no binary/glue/declaration promotion or mixed-artifact test was
performed for this producer checkpoint.

Bounded native draft-count fix `51c4fd12f0` is integrated alone as `7464135a8f`.
No optional plugin moves or format-only perf-branch commits were consumed. The
plugin counts direct mutations and attachment-changing subtrees, rebuilds full
reconciles, and avoids extension copy-on-write when the count stays unchanged.
The crate guide now records this bounded-work rule. The portable model boundary
is unchanged: draft-mark policy remains in the Macro model plugin; no transport,
authorization, foreign registry, transaction API or ABI changed.

Independent combined-source validation in the disposable checkout passes all
100 default Macro package tests, strict all-target Clippy, the wasm32 target
check and scoped root `just check`. The new regression measures exactly two reads and zero comment
visits for plain typing at 190 / 3,835 / 36,530 nodes; lifecycle and snapshot
replacement cases also pass. The owner reports replay1,364 passed / zero failed /
57 unchanged ledger entries (1,421 successful harness trials); that replay and
the owner's separate TypeScript/source-export checks were not independently
repeated here. No latency improvement is claimed and no shipping WASM rebuild
or live asset promotion occurred. The broader workspace/matrix remains paused.
Evidence: `draft-count-integrated-{tests,clippy,wasm-check,check}.log` and
`draft-count-integration-audit.md` under the acceptance directory.

Main source remains ABI2; the live preview is still the unchanged `9c21b03842`
artifact. No production action, deployment, stack restart, live dependency write
or live artifact promotion occurred. Integration3 and production compatibility
remain unchecked; the broad matrix remains paused.

The coherent public-config set is integrated: full type `1e32a1ee1a` as
`8b5430123d`, normalization `10105706ec` as `7c85d12c1a`, node consumer
`6f355a243a` as `07f699a581`, guarded view `c58014a9ae` as `644a04c948`,
pure selection helpers `cf2ad6509d` as `756710781f`, exact config constraint
`a234af30cc` as `ce891a4b13`, and generated hook evidence `781b9adfa9` as
`0c60245bab`. The helpers were consumed independently before the later view
checkpoint; the whole set was then validated together without rewriting history.
At that earlier configuration checkpoint the central budget was three; its helper SHA256 was
`05b42b9038f91bc1c17495e8c673d29fe6345bdfac9dbc365b098c9f38ce4d9b`.

Independent whole-set results at that source epoch:

- Full shim `bun run check`: **PASS**, including ordinary TypeScript and all
  **41 hooks / 489 pinned sources**. This standalone package uses its committed
  local frozen lock, TypeScript **6.0.3** and Vitest **4.1.5**. Root TypeScript
  5.9.3 produced a different first caller; its diagnostic regeneration was
  discarded, then the package-local frozen install was run only in the disposable
  copy. No hook evidence was weakened or hand-edited.
- Full view-package TypeScript: **PASS**, including fixtures/specs/setup, with
  no exclusions, option changes, casts or private source projection. The earlier
  full-view variance blocker is closed for this source set.
- Complete real development-WASM shim suite: **195 passed / 1 failed** of 196.
  The unchanged graph-read assertion observed **2,396 native crossings**, expecting
  zero. This is a real open gate, not a waiver or production performance proof.
- Guarded DOM unit suite: **59/59 PASS**, portDOM with the unchanged upstream
  model; this is separate from native-engine evidence.
- The 275-case node runner **blocks before collection** without a verified native
  mapper. No Original/dev-Conformance fallback was supplied. The original seven
  spec hashes are verified by the node owner; the fail-closed validator is
  candidate-only and cannot certify engine identity.

Evidence: `coherent-config-independent-validation.json`,
`coherent-config-shim-pinned-full-{check,tests}.log`,
`coherent-config-disposable-view-full-check.log`, and
`coherent-node275-blocked.log` under the acceptance directory. Main's direct shim
check initially found a stale ignored development artifact; the independent copy
rebuilt actual conformance WASM instead of suppressing its missing exports.
The mandatory full namespace oracle/CI hooks `d292edc20b` and `08f0238379` stay
unmerged until the complete production compat package is available.

The subsequent **source-only** metadata/root pair `58f046811e` / `af059c0e64`
is integrated as `fe50966074` / `c935e5a2eb`, with observed-getter corrections
`276f948e46`, Paragraph JSON correction `f1fba26c9b`, deferred selection operands
`7b973f59cb`, and Text DOM-slot regression `4b24915123`. Together, full shim check
and full view types passed at that earlier source epoch. Its complete suite was **197 passed / 4 failed** of 201,
plus one unhandled error: three editor cases require the still-unmapped raw
`__cachedText` capability, and the 2,396-crossing assertion remains. The development
backend rejects unavailable update metadata explicitly; no empty sets/constants
or fabricated references were substituted. Positive raw-cache/dirty metadata,
codec/ref lifetime, NodeState/clone and actual backend acceptance stay open.
Logs: `root-dirty-pair-{shim-full-check,shim-full-tests,view-full-check}.log`.

Priority recovery fix `a112c98066` is integrated as `a0ae94baf8`. The production
conflict retains `deferred_seeds.clear()` and the existing efficient
`doc.oplog_frontiers()` path. Existing presence tests and the new seed-adoption
modules are both retained. The missing parent seed-17 story was restored and
registered explicitly; unrelated absent parent modules and their coverage claims
were not invented. Combined checks pass **171 core / 50 session + 1 telemetry**,
startup-adoption property/negative controls, and the seed-17 startup/replay story.
These are targeted controls, not a fresh full integrated T0 clearance.

The Android owner verified the real held-JNI regression **2/2**: zero Initialize
before releasing actual adoption, exactly one after release with recovered
`durable😀`, plus the snapshot control. This uses source `a112c98066`, owner
adoption `7ae52784e8`, FFI source `e2b9430bc0` and fixture `c397b18f8f`.
Its immutable JNI artifact was independently rehashed here: **223,553,488 bytes**,
SHA256 `7028c5e3083d9ae437ef89dc2740c38a62a03288e9f357edb5c24ef246816b3a`.
This records owner test execution and independent artifact integrity, not an
independent JNI rerun or a WASM substitution. Evidence:
`wal-adoption-priority-{core-session-tests,simulator-tests}.log`,
`wal-adoption-jni-independent-rehash.json`, and the external
`android-seed-adoption-jni-provenance.json`. No Android/Tauri implementation was
merged into this worktree.

Native source foundations include reserved-key capabilities `32f858079e`,
compat-only static-transform ownership `58ca265de7`, retained tickets `fe8c4f71e5`,
pre-import hooks `65beae563d`, owned-call extraction `2c87ba1d6a`, builtin overlays
`2abc6f4727`, hosted schema `d9e425cd7d`, transport `cc95c4f0bc`, dirty schema and
consumer `be54d30c31` / `a164526cbf`, and metadata borrow release `8094225421`.
Schema fingerprint is `5f316f2121a2d04941202ee924d6c70f974fdb19dbec490a2cb898d9eb4962bb`.
None installs a hosted factory or activates the resolver. Newer native execution,
read-snapshot and cache-accessor checkpoints remain queued for a coherent pass;
the older immutable WASM archives below do not represent these newer sources.

The exact OFF behavior inventory chain through `e06da8c0b8` is integrated, keeping
`331efdaea6` before registry expansions and the watcher fix before transform cases;
`c12461e132` was excluded. The owner reports **22,440 full-web tests passed**, two
optional cases, media **36** and rendered image **99/99** OFF. There was no duplicate
broad OFF rerun here. Newer code/table/task/link inventory continuations remain
queued. These are separate source-linked observations, not a summed test run,
exhaustive behavior count, ON result, persistence or full AX acceptance.

Scoped repository check passes (`coherent-source-final-scoped-check.log`).
The incremental audit found no new source defect and accepts the WAL conflict
resolution, exception budget and fail-closed oracle fix; acceptance failures
remain explicit. Audit: `audit-coherent-config-wal-checkpoint.md`.

## Combined ABI2 native build and source continuation

The next native batch is integrated through `533d924824`: owned selection
execution and sidecars (`280eedbc74`, `e57639abe4` with immediate fixture
consumer `30deb6487b`, `ec7bb64e81`), read-update facts (`d4ae8075b5`), exact
captured root cache (`9086955a4d`), raw numeric alignments (`4318adbc18`) and
raw writes without virtual redispatch (`6ba489b5f8`). The paired schema is
`2b50fa92778c62e50c0a67cf891fd9405c51c34dc0efbcae6ee3da161cd079b2`.
Combined all-feature tests pass **60 WASM / 479 model / 7 HTML plus one
integration**; strict all-target/all-feature scoped clippy and scoped repository
checks pass. Existing default Macro behavior is retained; actual hosted factory
and class callback execution are still not ready.

An independent branch in the disposable copy built exact ABI2 source
`533d924824` with the normal shipping recipe, six opt3 callers, `-Oz --converge`,
pinned tools and two Cargo jobs. Result: **9,038,468 raw / 2,035,592 Brotli bytes**,
SHA256 `9954982f0c4797b3da050e8c3d869f30870186f9118945e7ca80d32129b7d2ba`.
Immutable manifest: `wasm-attribution/abi2-native-combined-manifest.json` under
acceptance. This exceeds the advisory ceiling and has no new speed/acceptance
claim; it is not installed in the preview and does not replace the older ABI3
comparison archives.

The source-generated ABI2 declarations add 106 lines, retaining all existing
member names, including the common compatibility API and scoped transport.
They contain no held ABI3 `textDeltaFromView` / `textResyncFromView` primitives.
Only those declarations were copied into main (`ed93772565`); no binary/glue
was promoted. Proof: `abi2-native-generated-declarations-proof.json`.
Matched artifact tests pass **86 session / 253 view**. Actual cold WASM reports
schema `2b50…`, protocol1 and 41 hooks; module dispatcher installation succeeds,
and a callback outside a live synchronous scope rejects without invoking the
dispatcher. This tests transport boundaries, not class hooks or initialization.
Logs: `native-read-metadata-integrated-{tests,clippy,check}.log`,
`abi2-native-combined-{build,session-tests,view-tests}.log`, and
`abi2-native-cold-smoke.json`.

DOM predicate correction `877c9e9c54` and the source-only target probe
`3e3cb3c818` are integrated (`c26237dfbe`, `5cc1715dde`). Guarded DOM tests pass
59/59, full view types pass, and scoped checks pass. Target probing is not native
deletion/behavior adoption. Positive root-derived JS cache population, raw cache,
dirty metadata, native class hosting, zero-crossing and native275 gates stay open.
That source epoch's complete shim run was **198/202**, with the same four failures and
one unhandled raw-cache error; full source/hook and full view checks pass.
Evidence is in `dom-probe-*` logs. Source artifacts were rebuilt in the
disposable tree without changing compiler options. The independent source audit
(`audit-native-abi2-source-checkpoint.md`) found no new source defect and verified
the archived WASM/DTS hashes. The advisory ceiling overage is435,592 bytes;
initializer, native oracle, positive cache/crossing and parity gates remain open.

The OFF inventory continuation through `16efcecd73` is integrated, including code,
table picker, checkbox/task conversion, link and mounted TaskList fixtures. Owner browser evidence
is 114/114 code, 132/132 table and 153/153 link OFF cases, each across three
viewport profiles; these are not native mobile/virtual-keyboard proofs. The exact
ledger has 796 selectors across ten explicit reports (full web22,440, media36,
conversion11, TaskList19, checklist planning32, checklist collection5, iOS caret8,
blame hover14, typed popup20, focus guards8), including535 new editor units; it is not a summed
full-suite run, deduplicated behavior count or ON acceptance. The 19-case TaskList
report replaces the earlier 12-case report. No duplicate broad OFF run was
launched here. TaskList commits `16d9f311d3` / `65fa6cf3b0` are integrated as
`09635f91a7` / `23aab1afdc`; the independent disposable checkout passes all
19 focused tests, and scoped `just check` passes. Mounted inherited ListNode
hooks cover kind transitions and ordered-start identity, not native/custom-class
hosting or the actual controls UI. Production declaration-oracle hooks and the
resolver remain held.

Mapping-only `ee31d991ed` / `5e9faf1616` are integrated as `a7c73d4cd1` /
`edc86a8f77`. The nine existing agent-slash/checklist selectors add no new test
execution. Checklist controls documentation now describes progress, filter
dimensions and dimming; grouping/collapse is not implemented. The independent
scanner validates707 mappings/source anchors. It correctly credits zero OFF
results in the disposable root because raw reports name the owner's different
absolute root. A separate read-only exact-selector check confirms707 unique
passing owner-path entries without rewriting reports; this does not establish
execution/source binding. At that mapping-only checkpoint new editor units were448
and browser cases153.
Evidence: `inventory-707-scanner.log`, `inventory-707/source-ledger.json` and
`inventory-707-owner-selector-verification.json` under the acceptance directory.

Checklist planning continuation `3b4d2afdf2` is integrated as `334b85c124`.
Independent focused execution passes32/32 OFF cases and scoped `just check`.
The tests pin calendar/priority boundaries, task-fact precedence, filter
composition, progress/wrapper order and actual DOM dim/clear/stale-key handling.
Task facts are supplied; dropdown UI, real queries and native hosting remain
unverified. The fifth report is separate from the earlier full run, with no
duplicate broad web execution or ON claim. Evidence:
`checklist-planning-independent-tests.log`, `checklist-planning-scoped-check.log`
and `checklist-planning-integration-audit.md` under the acceptance directory.
The updated scanner validates739 source mappings; the same preserved absolute
owner paths still earn zero disposable-root OFF credit. Read-only verification
finds739 unique passing owner-path selectors across the five reports, without
rewriting them or asserting source/execution binding:
`inventory-739-owner-selector-verification.json`.

Real-node checklist collection `893d1a4cdf` is integrated as `42e0315034`.
Independent focused execution passes5/5 cases and scoped `just check`. Cases
cover root/nested checklist progress boundaries, wrapper ownership, date/task
precedence, assignee deduplication and metadata removal after committed edits.
The sixth report adds no controls UI, real query, ON or native admission proof;
browser evidence remains153. Evidence: `checklist-collection-independent-tests.log`,
`checklist-collection-scoped-check.log` and `checklist-collection-integration-audit.md`.
The scanner validates744 source mappings. Preserved owner paths again earn zero
disposable-root OFF credit; exact owner-path verification finds744 unique passing
selectors across six reports, with no raw report rewriting or source/execution
binding claim (`inventory-744-owner-selector-verification.json`).

iOS geometry increment `647a597688` is integrated as `d6e6deda2a`. Independent
8/8 cases exercise the real caret-scroll plugin and model-selection fallback with
supplied window geometry and timers. Two additional mappings refer to existing
backspace cases; they do not add new tests. Physical keyboard, native iOS layout,
deletion and animation acceptance remain unverified; module-import warnings are
preserved. The older browser153 result remains pinned to `62601ac3c6`.
The scanner validates754 mappings and exact owner-path verification finds754
unique passing selectors across seven untouched reports, with zero disposable-root
credit and no source/execution binding claim. Evidence:
`ios-caret-independent-tests.log`, `inventory-754-owner-selector-verification.json`
and `loro-ios-integration-audit.md` under the acceptance directory.

Rendered checklist extension `5ad1756ae1` is integrated as `9900feb7ec`.
The owner-run fresh OFF browser report has171 passes (57 scenarios across three
viewport profiles), zero skips/flaky/unexpected/root-reporter errors and exit0.
Its report hash/statistics were independently verified, not rerun here. Six new
scenarios mount the real collector/store/TaskListControlsRenderer with production
providers and blocked remote requests. **OFF touch filter activation remains
broken**: after touchend the trigger has pointer-events:none and the bar intercepts
hits. The keyboard path has an explicit focus precondition and does not establish
touch access. Production runtime is unchanged; the fixture README preserves source
locations/reproduction and no ON/service/native keyboard/filter-permission
admission claim. Evidence: `checklist-browser-171-owner-evidence.json` and
`retirement-checklist-browser-integration-audit.md`.

Blame controller increment `2e1b512093` is integrated as `80d8a569ff`.
Independent14/14 cases exercise real-node stable-ID lookup, native selection
guards, supplied touch capability, dismissal/captured scroll, root replacement
and disposal. No rendered tooltip or service attribution is proven. The scanner
validates768 mappings; exact owner-path verification finds768 unique passing
selectors across eight untouched reports, with zero disposable-root credit and
no source/execution binding claim. Unit count507 and browser count171 are separate
evidence, not a whole-suite sum or exhaustive denominator. Logs:
`blame-hover-independent-tests.log`, `inventory-768-owner-selector-verification.json`
and `fence-checklist-hover-scoped-check.log` under the acceptance directory.

Popup controller `d2df65c167` is integrated as `b1ec8f67ab`. Independent20/20
focused cases and scoped checks pass. Tests use real range/node/table selections
and the Markdown parser, with only touch capability, jsdom geometry and timers
supplied. Explicit numeric rectangles cover cache fallback after native range
clearing, host rejection, table backoff, deletion yielding, full-block replacement,
highlights, guards and disposal. Rendered popup, AI/service and native table-bar
coverage remain open. Only the typed popup report contributes to the ninth report;
obsolete opaque-rectangle/pretyped reports are excluded. Scanner788 mappings and
exact owner-path788 unique passes are independently verified, with the same zero
disposable-root credit and no source/execution binding claim. Browser171 is
unchanged. Evidence: `popup-selection-independent-tests.log`,
`popup-selection-scoped-check.log`, `inventory-788-owner-selector-verification.json`
and `popup-selection-integration-audit.md` under the acceptance directory.

Focus guards `16efcecd73` are integrated as `a13e83e768`. Independent8/8 cases
use real editor.focus, native DOM Selection/activeElement and a mounted TaskList
unmanaged slot with a host-owned button. Mouse/pen next-timer, touch499/500 policy,
embedded ownership, disposal and root replacement are covered. Supplied pointer
types, cancelable focus events, fake timers and jsdom geometry do not prove native
physical timing. No editor method is mocked. The scanner validates796 mappings;
exact owner-path verification finds796 unique passing selectors across ten
untouched reports, with zero disposable-root credit and no source/execution binding
claim. Browser171 is unchanged. Evidence: `focus-guards-independent-tests.log`,
`focus-guards-scoped-check.log`, `inventory-796-owner-selector-verification.json`
and `static-factory-focus-integration-audit.md`.

The three reported package formatting locations also pass read-only Biome checks
from their package directories: two collaboration files and the view clipboard
host test. The initial repository-root invocation failed nested configuration
resolution and is retained as a diagnostic, not a formatting result. No edits to
those files were needed. Evidence: `tasklist-dom-independent-tests.log`,
`tasklist-dom-source-check.log`, `reported-collaboration-format-check.log` and
`reported-view-format-check.log` under the acceptance directory.

## Earlier checkpoint: held ABI3 validation

The main application-source checkpoint is `2e335cdcc5` and remains ABI2. The live preview remains on
`9c21b03842`; no dependency directories, live artifacts or stack processes
were changed during this validation. Integration3 and full compatibility
acceptance remain unchecked.

The independent validation repository at
`/home/wolf/tmp/editor-parity-validation` contains ABI3 adapter `bbc9e61b48`
and TierC `f1f35b6b01`, followed by production-policy replay `64a4524426`
(cherry-picked as `08041388db`), with combined generated declarations
committed separately as `ce944c041c`. Both full and delta view commands use
production `EditorCore.apply`, recovering the same editor and allocator.
Conversion errors retain unchanged comparison snapshots. The owner reports
105 TierC cases, including three 10,000-step seeds and nine preserved tapes,
passing; this supersedes the earlier raw-adapter coverage qualification for
that source. Independent native conformance verification passes **29/29**
on the combined staging source (`abi3-production-core-conformance-tests.log`);
no independent optimized 105-case rerun is claimed yet.

The latest combined application/ABI3 build at `4f0eb3d6bf` is raw
**8,937,649 bytes**, Brotli **2,012,635 bytes**, SHA256
`9f368fb4cbf10dc93cae654326350050bbb55594d616bf3383adaa73150a549b`.
It is frozen separately in
`wasm-attribution/candidate-abi3-application-manifest.json` under the acceptance
directory. Generated declarations are unchanged. Matched session **91/91**,
view **255/255**, and collaboration type checking pass on this artifact.
This build is 8,799 raw / 1,485 Brotli bytes smaller than the preceding
candidate; no single-change size or performance attribution is claimed.
It remains held with the same unresolved type/readiness/performance gates.

The preceding immutable build at `08ade11a39` is raw
**8,946,448 bytes**, Brotli **2,014,120 bytes**, SHA256
`4941015d3468997787e9d89919782b662806ace78bb788207f8d8636f27f74ad`.
Compared with live this adds 647,642 raw / 128,305 Brotli bytes. Its source
and artifact identities remain bound to that checkpoint, not the later replay
follow-up. Attribution manifest:
`/home/wolf/tmp/integration3-acceptance/wasm-attribution/live-vs-abi3-manifest.json`.
Final artifacts have no name/DWARF sections; the candidate pre-bindgen sibling
retains names. Size attribution and measured typing/paste improvements remain
pending. The artifact is held and has not been installed in the preview.
Preliminary parser/Twiggy attribution reports +636,436 code bytes, +8,899
data bytes and 633 additional functions. Legacy text input and explicit
resync share one WASM function body, so those exports are not duplicated
implementations. Eighteen compatibility exports are newly present compared
with the live build. The size owner completed an exact-source `08ade11a39`
ablation using `--no-default-features --features bebop-owned-all`, retaining
the six opt3 caller crates, toolchain/profile and optimization passes:

| Source / feature group | Raw bytes | Brotli bytes |
| --- | ---: | ---: |
| Live `9c21b03842` | 8,298,806 | 1,885,815 |
| `08ade11a39`, compatibility enabled | 8,946,448 | 2,014,120 |
| `08ade11a39`, compatibility disabled | 8,319,259 | 1,887,011 |

The independently verified compatibility-disabled SHA256 is
`3a52b8d396a0d13dffc770cffccd70d3f36e93ffa4b05c26b523e519fe1f288c`.
The feature group accounts for **127,109 Brotli bytes** on this exact source;
compatibility-disabled is **1,196 Brotli bytes** above live, including every
other source difference. Neither remainder nor total growth isolates the
ABI3 delta adapter. The immutable manifest SHA256
`30fe8b54893f8d80d2a25dd6862178762fbdc15d5491596c0756cbf190a24d3f`
and all six artifact hashes/byte sizes were independently verified. Compression
was independently recomputed at **1,887,011 Brotli bytes**. Manifest/profile
metadata matches the pinned comparison; the directory and files are read-only.
Manifest: `/home/wolf/tmp/lexical-port/editor-perf/abi3-size-attribution/abi3-08ade-no-compat/manifest.json`.
Evidence: `no-compat-ablation-independent-rehash.json` and
`no-compat-ablation-independent-size.log` under the acceptance directory.
This verifies the supplied artifacts, not an independent rebuild. It is not a
shipping variant, export-removal decision or performance acceptance. The newer `4f0eb3d6bf`
application artifact stays separate. Exact full-string aliases share function
8879. A named optimized sibling is pending code-section equivalence checks;
its names are not yet attribution evidence. Public export changes remain
coordinated with the native and JS compatibility owners.

Matched ABI3 session tests **91/91**, view tests **255/255** and collaboration
type checking pass. Full view-package type checking **fails** on structural
DOM contracts in fixtures/tests, including callback variance and recursive
node interfaces. Focused DOM units/type checks do not close this failure.
Evidence: `abi3-combined-view-types.log` under the acceptance directory.
No cast, suppression or parity allowlist was added.

Main-source corrected validation passed session **48 plus one telemetry**,
FFI **4**, WASM **47** and model **465** tests. The corrected FFI source
`7f14666e6c` / bindings `5f76c9ce8e` are integrated as `57e349f821` /
`ae2e52324c`. Binding freshness also passes with conflicting Android target
and task-local target-directory overrides: the generator explicitly builds
and reads host-target output, leaving the override sentinel unused. This
closes the earlier RequireView and inherited-target audit findings.
Evidence: `compat-selection-ffi-correction-tests.log` and
`ffi-correction-host-target-freshness.log`. Application-config extraction
received final owner audit approval and is integrated separately as
`fa777fc8d3`, with generated bindings `8e876692a7` integrated as `2e335cdcc5`.
Combined session **48 plus one telemetry**, FFI **5**, WASM **47**, strict
all-target scoped clippy, scoped `just check` and dependency checks pass.
The normal wasm32 client dependency graph excludes server/composer crates.
Independent integrated binding freshness passes against explicit host output. Android
foundation `cc7c6dbb9d` is separate and unconsumed; app admission is unchanged.
The held validation branch includes the application pair and mechanical
formatting at `4f0eb3d6bf`; its combined build and matched package tests pass. The immutable
`08ade11a39` artifact remains evidence only for its earlier source.
Logs: `application-profile-integrated-{tests,clippy,check,deps,bindings}.log`
and `application-profile-wasm-normal-deps.log`.

Selection operations and validated class-mask admission are now integrated;
hosted callbacks, complete compact-batch execution, remote-hold/rebase and
external-publication delivery remain pending. No production initializer or
resolver activation is claimed.

The completed OFF diagnostic baseline has 60 fresh processes per stock
Chromium/Firefox, zero failed rounds and no load interruption. Boot/composer/
document-open p95 milliseconds are Chromium **974.7 / 1502.6 / 300.1**,
Firefox **977 / 1654 / 714**. OFF engine-ready is unavailable because it does
not preload WASM. This shared-host observation is not a strict performance
acceptance or a paired ON comparison. Raw SHA256:
`3328c726a7b1ba68818c877d2155c764264c2de0598f84ca4d5b566fe0e253ca`;
full method and bounds are in the external `editor-boot-baseline.md` report.

A current root check found three inherited test-format/import-order errors;
mechanical corrections are committed as `a16cce48ca`. The formatting-only
diff was reviewed; the full root `just check` rerun passes (existing warnings
retained). UniFFI output is preserved verbatim; `git diff --check` over the
generated binding commit reports generator whitespace, not source edits.
Scoped held-source conformance clippy also passes with `-D warnings`
(`abi3-production-core-clippy.log`). Delegated incremental audit could not run
because its service authentication was invalidated. A limited direct audit is
recorded in `audit-current-held-abi3.md`; no independent sign-off is claimed.
Hexagonal boundaries were checked: replay delegates to existing core input
policy, adding no I/O or authorization policy.

The historical post-recovery T0 failure remains seed
`9486392389341030173`: `final state changed during quiet window`.
No new full T0 run has cleared it. The full matrix remains paused pending
compatibility readiness.

## Earlier checkpoint: same-session bootstrap and measured speed profile

Integration3, production compatibility, UI parity and strict performance gates
remain unchecked. The production resolver/document factory is held: the additive
native bootstrap at this earlier checkpoint rejected callback hosts/nonzero
class masks and did not yet implement selection mutations. Existing preview
evidence is native, not full Lexical compatibility acceptance. No production services or deployments changed.

The live preview remains on source `9c21b03842`, built locally with the six hot
paste caller crates at opt-level 3 (`1aa5b67c15`, integrated as `9c21b03842`).
Other dependencies retain their existing optimization. The integrated artifact
is raw **8,298,806 bytes**, Brotli **1,885,815 bytes**, SHA256
`a4e515765a4a9be69b592bdd1dd3444328d96a84c2d2b7d786b7658bb97db866`.
The previous complete close/render/allocator build at `f3cec5ac8b` was raw
6,925,286 / Brotli 1,585,355 bytes: this checkpoint adds 1,373,520 raw /
300,460 Brotli bytes, including the shared-read/tail changes. This is not a
single-crate size ablation. The 1.6 MB Brotli ceiling is advisory, and retaining
this measured speed improvement above it was explicitly accepted. The existing
policy is `8fc4648aaf`; no earlier hard cap was reapplied.

The profile owner's 90 randomized paired native observations preserved exact
text, Markdown, model and raw DOM. Paste medians before/after were stock Firefox
55/45.5 ms (upper 95% ratio .8664), stock Chromium 54.35/41.55 ms (.7895), and
Linux WPE 50/40 ms (.8530). These are native diagnostics, not compat, Safari,
quiet-main-task, startup or document-open acceptance. The own source-matched live
80-paragraph/160-link paste retained model/DOM content, produced no page errors
or injected containment, and kept memory at 19,922,944 bytes. Evidence:
`opt3-integrated-live-artifact.json`, `opt3-live-paste-result.json` and
`opt3-live-paste.png` under `/home/wolf/tmp/integration3-acceptance/`.

Since the earlier report, integrated the shared immutable selector/readiness
and idle preparation (`58c98196e0`, `9eb170d10e`), allocator reserve
(`bb8094bb64`), capture/instance ownership foundations, raw render metadata
(`52229da0e7`), event-buffer/metadata-only undo optimizations, native terminal
Close fix (`f3cec5ac8b`), and session-only JS host (`89ec1deded`). At the complete
Close checkpoint, local tests passed: core 169, session 49 plus one integration,
WASM 21, Loro 45 and model 452; view 253. Two focused close simulator stories
passed; this is not a fresh full T0. The host owner verified all 27 real WASM
host cases across three browsers against the exact integrated artifact SHA
`e3f02481c7ea516ec16a01365ebff8c573f0e1eeed29587ae3687e4732f31857`.

Latest source-only additions are schema `3f2c7e93f6`/`854a565978`, selection
classes and active-graph distinction `3081a3894c`/`52e57aca16`, DOM public types
and callbacks `fc0bcbb013`/`8f75100e8f`, capture authority `01cc15ee79`, and
same-session WASM bootstrap `189c995d94`. Exact schema076 hashes match the
supplied immutable source: TS
`e5d9997b378d23c8f20c2431e8cf987e01c5544a5567f6364a66d8caa1025a73`, BOP
`070be58ecfd9ff40f9827c76dd19c35c3415c510f600a917c3d64fcaf572f7da`.
Before the Table schema addition, own selection constructor tests 7/7, DOM
units 59/59, DOM type checking and paired adapter browser cases 15/15 passed.
The separate upstream focused unit rerun passed 56/56. These DOM cases use the
upstream model. Native WASM tests pass 23/23 and model all-feature tests pass
455/455. Scoped root checks, dependency validation, strict all-target/all-feature
model/WASM clippy and WASM all-feature portability passed at that checkpoint.

The fresh optimized conformance build resolved the missing artifacts. Actual
`derive-hooks` output refreshed only the `selectionTransform` caller line from
2986 to 2991 (`1016951d5f`), retaining the same 41 hooks from 489 source files,
with no manual field edit or names/order/masks change. The full shim check
passed before the Table addition. The ordered-input generator checkpoint
`54bb4e63a7`, integrated as `2aede2daf9`, resolves schema freshness; the current
typed Table codec validation is recorded below. New WASM exports have not been
promoted into live glue/declarations or activated. No bootstrap gate is waived.
Audit: `audit-compat-selection-checkpoint.md`; current logs use `compat-` prefix.

The deterministic generator compiles one ordered combined schema and compares
private temporary outputs. Own first/repeat/reversed-file-creation checks pass;
a deliberately stale TS output is rejected without rewriting it. Output bytes
and mtimes remain unchanged in all check cases. At the Table checkpoint, the exact source hash was
`6fa1a5da990a2c205e8f3469ae21405fc223b24692d364389c45fe309048db09`.
Generated Rust SHA is
`eaed6cc88e5426aa8f1c442dbdb935f5c0f9040fa76762bf2daef0a4f62c0016`,
TS SHA is `71b6df5564991bf2f3c3865b654fa7092c4314e2d9d88e2f6fc9bb992bbf4667`.
The schema adds TableSelection discriminator 4, SetCompositionKey=55 and
CreateTableSelection=56. WASM tests remain 23/23 and scoped `just check`
passes (pre-existing shear warnings retained).

The typed Table factory/guard dependency `f8edc9ae2b` and codec `785399b54e`
are integrated as `e78e411499` and `1a61e7dd4b`. Explicit discriminator 3
handles NodeSelection keys, while discriminator 4 uses the unchanged injected
TableSelection factory and guard. No runtime table import, cast or fallback was
added. The full shim/hook check, focused `.mts` TypeScript check, seven
constructor tests, and scoped root check pass. Audit found no fallback or
ownership defect. Native Table snapshot roundtrip, cache/frozen/read-clone and
actual bridge behavior remain unproven and are prerequisites to activation.

The four original immutable selection suites pass **65/65** (53 + 3 + 6 + 3)
in a fully owned source/dependency copy, with all four spec hashes retained.
Its original Vitest config/setup and test tsconfig also match pinned upstream
`0cfcc169296723e07de2396cd42ea3434b5b79ed` Git objects byte-for-byte.
Provenance is `portDOM+upstreammodel`, with `nativeAcceptance:false`.
An explicit actual-native run without its mapper fails before collection,
records zero cases and never falls back to the source model. This is a
fail-closed control, not native acceptance. Evidence under the acceptance
directory: `compat-table-schema-reproduction.json`,
`compat-table-schema-wasm-tests.log`, `compat-table-codec-shim-check.log`,
`compat-table-codec-mts-check.log`, `compat-table-codec-constructors.log`,
`compat-table-codec-root-check.log`, `compat-table-codec-oracle.log`,
`compat-table-oracle-results/{vitest,provenance}.json`,
`compat-table-oracle-config-integrity.json`, and
`compat-table-codec-native-blocked.log`.


Latest schema-only checkpoint `7a101d5de7` is integrated as `4f222d8ed4`.
`CompatInstanceBind` carries an exact record plus instance-owner, class and
instance IDs. Its instance-binding checkpoint fingerprint is
`8feac1f170dc0613b15934c07fa4f001add1fb0f07f3facd5b36b8b9cf7acddf`;
generated Rust SHA is
`2b407548a30d84b93bd22cd091b179d0dd0b5001fd2e815b9e3d475649ff4be1`,
TS SHA is `490c70ade13915594218769f73ec1bc0999c5622d9233d54be1d0e9d7e660d48`.
Own repeated/reversed-creation/nonwriting-failure checks, all 23 WASM tests,
full shim TypeScript/hook checks and scoped `just check` pass. Audit found no
defect in the additive schema. Nonzero ID/owner checks and exact native
hydration are responsibilities of the forthcoming native consumer; a schema
alone does not implement them. No live glue/artifact or app switch changed.
Evidence: `compat-instance-schema-{reproduction.json,reproduction.log,wasm-tests.log,shim-check.log,root-check.log}`.
The compatibility owner separately reports 163 optimized conformance tests
across 31 files; that is not production Rust Tier B or initializer acceptance.


The publication envelope `6a52b4fbf9`, cold typed configuration `23e2b17731`
and executor `runSync` `5bb990bbcc` are integrated as `2e78f1a546`,
`3bbb38097e` and `9891e72e8b`. `CompatPublications` retains typed commit
metadata; queue delivery and actual dirty/tag/current-version receipts remain
the native consumer's responsibility. The publication checkpoint schema fingerprint is
`f54016202934ac63303df846dbcb5abdc26e3cb57aa3797a74c238ce417af999`,
verified independently against the three source files and both generated
languages. Freshness checking passes.

`runSync` rejects busy, queued and closing/closed executors before invoking or
queueing the rejected call, then uses normal output application and synchronous
completion. It does not transfer asynchronous host-close ownership or close a
borrowed session on root unbinding. Own real-WASM session tests pass **86/86**,
including all **25 executor tests**. The cold typed binding passes all **166
conformance tests in 32 files**, full shim TypeScript/hook checks, collaboration
package and session-test type checks, and a fresh module import with WebAssembly
compile/instantiate/constructors plus fetch disabled (zero calls). This proves
cold module evaluation only. WASM native tests remain 23/23; scoped root checks
and audit pass, with existing warnings retained. No production backend,
initializer, Rust Tier B or application activation is established by this batch.
Logs: `compat-cold-config-{shim-tests,shim-check,import}.log`,
`compat-run-sync-{session-tests,types,test-types}.log`,
`compat-publications-{schema-check,wasm-tests,cold-sync-check}.log` and
`compat-publications-fingerprint.json`.


Core prerequisites `5084f26ffb` and `4169c44304` are integrated as
`f61123f885` and `44d22df2fa`; detached insertion correction `918df746e0`
is `0c4f93f5fa`. RequireView preserves source structural movement while
reporting missing DOM endpoints explicitly; NoView remains distinct. Presence
ports are Send and raw registry indices still require checked lookup. Detached
insertion resolves its split from Active while splicing the receiver block,
including the source empty-block case.

At `7cf7be3ad9`, the Group B declarations-only failures are fixed by moving
`plugins_group_b/mod.rs` byte-for-byte into `plugins_group_b.rs`, the rule's
preferred file-and-directory layout. All module/API paths and child imports
remain unchanged; no lint exceptions were added. Own validation passes:
169 core tests at the first prerequisite snapshot, then 459 model tests,
23 WASM tests, 52 Macro unit tests plus 46 integration tests, including the
20,000-case service oracle. Native replay passes 1,421 cases with zero failures
and the unchanged 57-entry ledger. Scoped checks, strict all-target/all-feature
clippy for core/model/Macro/WASM, and downstream all-feature wasm32 checking pass.
These are native correctness results, not production compatibility acceptance.
Logs: `compat-native-prerequisites-tests.log`,
`compat-prerequisites-group-b-{tests,check,clippy,wasm32}.log`, and
`compat-prerequisites-native-replay.log`.

Compact reservation schema `f5ad17a00c` is integrated as `a1fb7f7b31` with
paired hash `51304e5fdc885d3d80f50d777da8fe8a3f05ed1e39a1f740f2296b9cb58cce94`.
It defines native key reservations, captured/reserved operands, capture leases,
mutation epochs and sparse root-cache invalidation. Schema freshness and shim
TypeScript checks pass (`compat-compact-schema-{check,shim-types}.log`).
Messages alone do not establish their consumer behavior or initializer readiness.

The independent compatibility audit adds mandatory parity prerequisites:
stable JS node identity; at most two fixed crossings per update, zero per read,
and ten per plain-text keystroke; at most 4 KB per key and at most 10% growth
between 10-node and 10k-node documents; retained captures at most twice live
nodes after GC; typing p95 ON/OFF upper 95% ratio at most 1.0 for S/M/L; and
chapter paste with no task above 50 ms and rendering below 150 ms. No such full
plugin performance acceptance is established here. Linux WebKit remains an
engine proxy and cannot supply Safari acceptance.

The out-of-tree fail-closed gate now requires `compatPerfAudit` with agreed
requirements, actual producer bindings and node-identity/crossings/bytes/capture/
typing/chapter evidence. Its canonical source fingerprint additionally binds
`jsSha256` and `schemaSha256`. No accepting path exists until actual committed
instrumentation, a coherent JS/WASM/schema build and audited metric validators
are available. Protocol, native/source-model diagnostics and self-declared
passes cannot qualify. Contract:
`/home/wolf/tmp/lexical-port/browser-fuzz/validate-gate.mjs`; audit:
`/home/wolf/tmp/lexical-port/reports/wolf/compat-perf-audit.md`.


The sparse native prerequisite batch is integrated: f423 as `2a93e8aae9`,
selection helper 100cc as `22ecdcecd1`, raw selection metadata 77a19 as
`2c732579de`, and compact begin/reservations 74d as `f997509e85`. The
selection helper is not yet registered in the adapter; its literals cannot
count as active runtime support. Stable capture IDs and flat 10-vs-10k leaf
reply sizes are focused native evidence, not JS identity or full-plugin gates.
The owner separately built an actual basic 74d artifact with paired schema
51304 and passing create/StartSeed/reserve-eight/stable-root/append/commit/snapshot
smoke. It was raw 7,149,854 / Brotli 1,643,457 bytes on that branch's profile;
its old 1.13 MB check is obsolete here. No owner artifact was promoted.

Typed compact-batch schema ade843 is `3c74f56cd1`, fingerprint
`09ca9d476170325d1db727ed2cb2376027ef6bfeb64e310a502285e4ab504b93`.
Registry-cache 7be7 is `eb18627db4`; local graph selection reads 2b6 are
`dd7dea79d0`; structural DOM contracts 583 are `c748d671a0`. Own source-only
selection checks pass nine cases including 169 point pairs with native functions
made to throw. Structural DOM units pass 59/59 and DOM/shim types pass. A fresh
optimized source conformance rebuild passes 172 tests in 33 files. The initial
COPY run found an old renamed mod.rs left by the sync; only that stale source
file was removed, rename/deletion propagation was fixed, and the rerun passed.
No live dependency/cache files were touched. These are not native initializer
or complete TS API acceptance.

Native delta prerequisite 4562 is integrated as `04d6fc4db5`; it adds typed
UTF-16 delta input without changing the wire ABI or existing full-text method.
The combined non-FFI native subset passes model 465, session 49 plus one
telemetry integration, and WASM 24. The ABI-3 adapters remain owner WIP and are
not partially adopted; the live preview retains ABI 2. Final combined source
will regenerate all declarations rather than copying branch-specific artifacts.

Typed FFI b978 and matching bindings 90e are integrated as `8b5dfa9c3b` and
`706c1bc766`; upstream HTML/Markdown now share current document_session exports,
with the Macro branch preserved. Current FFI compilation and binding freshness
are BLOCKED: the remote ModifyTarget mirror omits RequireView from the newer
core. The owner is adding the exact variant, typed delta and regenerated bindings;
those changes are not yet committed/consumed here. Audit also identified a
bindgen artifact-path risk under inherited Cargo target overrides; its owner is
pinning the host target and own artifact directory. The attempted local check
used no target overrides and failed at compilation, so it provides no freshness
pass. Android host-plugin/application-profile WIP is excluded; no Tauri files
were touched.

The five behavior-inventory commits are integrated (`4480cf0e43` through
`2cf6c008ad`), preserving the honest docs and ON refusal. Own OFF validation
passes 181 real-plugin unit cases plus one scanner regression and 18 static
Chromium cases over desktop/tablet/phone. In-memory JSON, fixture ARIA and
screenshots do not establish production persistence, accessibility or parity.
No ON or exhaustive coverage claim is made. Full application OFF suites remain
with the inventory owner, who is building its own missing WASM from source.

Current logs: `compat-sparse-delta-native-tests.log`,
`compat-sparse-registry-shim-tests-rerun.log`,
`compat-local-selection-reads-tests.log`, `compat-structural-*.log`,
`behavior-inventory-{unit-tests,scanner-test,browser}.log`,
`compat-sparse-ffi-native-tests.log`, and `compat-ffi-bindings-freshness.log`.
The latest broad scoped check passed before the final native-delta/type commits;
its next rerun and FFI correction validation are queued after timing. Native
replay 1,421/0/57 above belongs to the earlier prerequisite snapshot, not this
new sparse/FFI/delta batch. All full bridge/performance gates remain blocked.

The private-network controller subsequently passed three clean 60-round batches
per stock browser (360 fresh processes, exact executable hashes), with zero
performance samples and no metric traces. This is reliability evidence only.
A fresh timing window is requested; own builds/checks will finish before the
explicit quiet-ready signal. Frozen OFF source/build/auth remain unchanged.


A frozen flag-OFF build with real timing marks is served at local port 39870,
source `751b62fbb1531d81a0cb4ac840c1346efb5648b3`; empty dirty-diff SHA is
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Its full build/source/input manifest is `off-current-build-manifest.json`.
A genuine Recent document row was verified via Drive -> My Files (no document
root) -> Recent -> trusted title click -> editable body marker. File-location
breadcrumbs are not result adapters. Fixture browser activity stopped before
quiet sampling. The OFF owner stopped fail-closed after 11 Chromium samples
when preparation timed out on round 12; no accepted baseline or sample trimming.
A separate fresh run under harness `dc9a43645b` stopped fail-closed after nine
valid Chromium records, when round 10 lost its execution context during initial
navigation. Neither run is an accepted baseline; no retries, trimming or resume
were counted. Frozen OFF assets, authentication and runtime were not changed
during either sampling window.

Tempo evidence already found `wasm.init`, `state.load` and `view.reconcile`
under `editor.open` in own exported traces, recorded in
`cache-gate-tempo-proof.json`; this is not a latency gate. The historical
post-owner-recovery T0 failure was seed **9486392389341030173**:
`final state changed during quiet window`. It has not been freshly reproduced
or cleared by a full T0 after the Close merge. The full matrix remains stopped
for the compatibility pivot. No DOM allowlist or native-to-compat waiver exists.

The sections below retain earlier checkpoint evidence and do not establish
current-source production compatibility or full parity.

Integration3 and UI parity remain unchecked. The full matrix is stopped for
the production compatibility pivot. The selected architecture now runs existing
Macro plugins, node classes and UI unchanged through the Lexical0.45 API over
the Rust core; hand-migrated native UI is not an acceptance prerequisite.

Current integrated foundation: `ef28a94993`; additive schema checkpoint:
`80da57bf21`. Earlier coherent checkpoints include shared chrome `dd14a125eb`,
native focus `b5ebeae724`, comment hosts `20d43cfbc0`, shortcuts `f4e44e44df`,
shared composition `100ea8ba00`, saved/export semantics `a591bbc834`, and heading
Enter `a486cd43f7`. The production compat initializer and immutable boot switch
are not yet active, so existing native preview evidence is not compat acceptance.

## Live paste checkpoint

Integrated autolink prefilter `0ae7063905` (source `fa25cc5c73`), layout
containment removal `29ac2efcac` (source `079423d4d7`), and updated size policy
`8fc4648aaf` (source `de155ff928`). The policy now reports a 1,600,000-byte
advisory Brotli ceiling. Startup p95 <50ms and document-open p95 <= OFF remain
strict and have not been established by this checkpoint. Shared boot preload
remains nonblocking; owner-branch benchmark files absent here were not restored.
Updated the web agent guide and session README to reflect this policy.

The source-matched shipping build at `0ae7063905` was installed into the live
preview as four artifact files only, without dependency writes or a restart:
raw 6,922,924 bytes, Brotli 1,585,235 bytes, SHA256
`11c44f6f0e29fe7c198cf6155dabd41e87d4c83363c3716d31362ed0c339ca98`.
Compilation and optimization passed; the original recipe exited on its old size
rule. Re-running the updated size reporter passed below the advisory ceiling.
This build includes the integrated foreign41 foundation.

Own headless Chromium passed an actual live HTML paste of 80 paragraphs with
160 URL/email links, verifying rendered content and native JSON blocks, with no
page errors. A second run verified absence of injected content-visibility and
intrinsic-size styles after the view change. Screenshot:
`/home/wolf/tmp/integration3-acceptance/preview-paste-prefilter-live.png`.
This is targeted native proof, not production compatibility parity or a quiet-box
performance comparison.

Local all-feature rich-node tests passed: 306 unit tests plus 2 integration
checks, including the 5,018-case upstream linkify corpus and the full-match
comparison property test. Scoped strict clippy passed; advisory size tests 2/2
passed under Vitest. Source audit found no false-negative guard defect. Logs:
`paste-prefilter-tests.log`, `paste-prefilter-clippy.log`,
`paste-size-policy-vitest.log`, `paste-size-policy.log`,
`preview-paste-prefilter-no-containment.log`, `audit-paste-prefilter.md` under
`/home/wolf/tmp/integration3-acceptance/`. The broad integration matrix remains
stopped for the compatibility pivot; no upstream compat or full parity gate is
claimed.

The two inherited check failures were fixed in `5157b020f5` (builder formatting)
and `5142b49c45` (Group A registration moved into its own module). The three
Group A shortcut tests passed. Generator-owned TS output now uses the existing
compiler-output exclusion policy in both package and shared web check entry
points (`3072b22f88`, `d559b553c6`); exact schema freshness passed for 27 fields
from 12 pinned classes. Disposable-copy `just check` is now **pass**, recorded in
`paste-integration-check-fixed4.log`; `git diff --check` also passed.

The published paired harness has 34 document cases, including strict heading
Enter, content-addressed per-case sidecars, standard Playwright JSON, raw full
Chromium AX diagnostic artifacts, and zero pixel tolerance. It explicitly fails
closed while production compat provenance, actual saved-state reader evidence
and full accessibility comparison remain unavailable. It does not substitute raw
model JSON for saved JSON. Root lifecycle/session injection remains held pending
the owner's real root-rebind contract.

Latest paired native checkpoints after containment removal:

| Case | Pixels | Markdown | Raw DOM | Saved JSON | Full AX parity |
| --- | --- | --- | --- | --- | --- |
| Empty | exact | exact | fail | blocked | blocked |
| Heading | exact | exact | fail | blocked | blocked |
| Bold | exact | exact | fail | blocked | blocked |
| Heading + Enter | exact | exact | fail | blocked | blocked |

Evidence: `parity-runs/20261109-005540` and `parity-runs/20261109-005816` under
`/home/wolf/tmp/integration3-acceptance/`. The latter includes raw full AX artifacts
for both engines. No DOM exception was applied. These checkpoints supersede the
earlier pixel differences in the historical evidence below; none passes the
production compatibility gate.

## Full native document parity round

The 34-case round completed under `parity-runs/20261109-005924`. Targeted
corrections/reruns are in `20261109-011710` and `20261109-012121`. No case passes
the production compatibility gate: all saved JSON and full AX comparisons remain
blocked, and all captured raw DOM comparisons differ. No DOM allowlist is used.
The superseding per-case results are:

| Case | Completed captures | Pixels | Markdown | Raw DOM |
| --- | --- | --- | --- | --- |
| bold | both | pass | pass | fail |
| bullet | both | pass | pass | fail |
| checklist | both | fail | pass | fail |
| code | both | fail | fail | fail |
| comment | OFF only | blocked | blocked | blocked |
| divider | both | fail | fail | fail |
| drag-block | OFF only | blocked | blocked | blocked |
| empty | both | pass | pass | fail |
| heading-enter | both | pass | pass | fail |
| heading1 | both | pass | pass | fail |
| heading2 | both | pass | pass | fail |
| inline-code | both | pass | pass | fail |
| italic | both | pass | pass | fail |
| link | both | fail | pass | fail |
| mention | OFF only | blocked | blocked | blocked |
| nested-list | both | fail | fail | fail |
| number | both | pass | pass | fail |
| paste-file | OFF only | blocked | blocked | blocked |
| paste-html | both | pass | pass | fail |
| paste-image | OFF only | blocked | blocked | blocked |
| paste-markdown | both | pass | pass | fail |
| paste-text | both | pass | pass | fail |
| properties | both | pass | pass | fail |
| quote | both | pass | pass | fail |
| reload | ON only | blocked | blocked | blocked |
| slash | OFF only | blocked | blocked | blocked |
| snippet | OFF only | blocked | blocked | blocked |
| strike | both | pass | pass | fail |
| table | OFF only | blocked | blocked | blocked |
| tags | both | pass | pass | fail |
| title | OFF only | blocked | blocked | blocked |
| toggle-checklist | OFF only | blocked | blocked | blocked |
| two-tab-collaboration | both | pass | pass | fail |
| undo-redo | both | fail | pass | fail |

Totals after targeted reruns: pixels 17 exact / 6 different / 11 blocked;
Markdown 20 exact / 3 different / 11 blocked; raw DOM 23 different / 11 blocked.
Standard Playwright reports and hashed sidecars accompany every run. Tests
explicitly fail closed instead of accepting the available matches.

Harness corrections wait for the actual new document route rather than its
transient loading route, select the named Table action and confirm its size
picker, click the rendered checkbox marker, and wait for body readiness after
reload. DOM selection is now recorded read-only before screenshots. These are
real UI interactions; no editor state or product debug API was injected.

Concrete gaps: title Tab-to-body navigation, slash/mention/snippet menus,
file/image paste, table insertion, checklist toggling, comments and block drag
complete OFF but not ON. Code omits the OFF plaintext language and Macro code
styling/accessories; a divider gains a leading newline; list Tab inserts a tab
instead of indenting; links/checklists differ visually. Undo/redo exports match
but caret placement differs (DOM selection artifacts retained). The corrected
collaboration case matches pixels and Markdown. Reload retained text ON while
OFF reopened empty after immediate reload; this remains an OFF baseline failure,
not an ON persistence failure or a parity pass. It is not silently delayed away.

This round exercises the pre-compat native document path. Shared chrome exists,
but unchanged JavaScript plugins/node classes still await the actual production
compat initializer, typed session factory and exact-root lifecycle. The new DOM
adapter's upstream-model evidence must remain separate from Rust-backed proof.

## Incremental verification

| Check | Result | Evidence |
| --- | --- | --- |
| Integrated model, all features |434pass | foreign41-core-tests.log |
| Shared/conditional/isolated hooks, including mixed rollback |16pass | shortcut-merge-core-tests2.log |
| Macro model + session WASM after export changes |119pass | export-saved-state-tests.log |
| Macro native keyboard group |49pass | heading-enter-native-tests.log |
| Native first keystroke: one handle, zero I/O, coalesced wake |1pass | shortcut-keystroke-counters.log |
| View package on source-matched Enter artifact |245pass | heading-enter-view-tests-rebuilt.log |
| Conformance WASM all-features native check |pass | foreign41-conformance-check2.log |
| Scoped strict clippy before foreign foundation |pass | shared-editor-scoped-clippy.log |
| App native TypeScript through export checkpoint |pass | export-saved-state-typecheck.log |
| Comment host/layout units |11pass | comment-adapters-tests.log |
| Shared chrome loading units |2pass | shared-chrome-unit.log |
| Dependency generator after41-hook merge |pass | foreign41-deps-generate.log |
| New foreign protocol freshness |pass | foreign-protocol-freshness3.log |
| Whole-workspace rustfmt |fail | shared-editor-rust-format.log; touched code formatted, unrelated vendor/builder drift remains |

Logs above live under `/home/wolf/tmp/integration3-acceptance/`. Initial failed
commands remain recorded, including stale-artifact view failures and harness
selector/focus corrections. Passing counts are tied to those checkpoints, not
a claim that the final integration matrix passed.

## Live preview proof and paired parity

Own headless Chromium, synthetic account/documents, matching appearance
preferences, existing hot ON stack and independent static OFF frontend were used.
No personal browser, live dependency/cache writes, stack restart, deployment,
production operation, database reset, push or branch rewrite occurred.

Strict live `# title` then Enter passes on the rebuilt application session:
JSON block types are heading+paragraph, exactly one paragraph exists, and model
and DOM caret both point to its start before the managed BR. Evidence:
`preview-heading-enter-result.json`, screenshot `preview-heading-enter-live.png`.
The earlier heading-only screenshot is `live-heading-Test-after-shortcut.png`.

| Document case | Pixels | Accessibility snapshot | Markdown | Saved JSON | Raw DOM | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| Empty, matched preferences |exact |exact |exact |blocked |differs |fail |
| Typed heading, fresh document |differs |exact |exact |blocked |differs |fail |
| Typed bold, fresh document |differs |exact |exact |blocked |differs |fail |
| Strict heading Enter model/DOM caret |not a full paired pixel case |not a full paired AX case |not measured |raw model validated |caret validated |targeted native regression pass |

The33-case paired harness currently resides in the independent validation copy
at `apps/web/src/features/block-md/browser-test/parity`; publishing the complete
harness and adding actual production saved-state reads remain work in progress.
Every full case remains fail/blocked until all required comparisons pass. The
production compat hard gate additionally requires unchanged upstream unit/e2e
suites, all Macro editor suites ON, per-surface parity and clean differential
browser evidence. None of those is inferred from the native preview above.

The empty pixel difference originally came from distinct persisted accents,
not a permitted pixel exception. Using the same test appearance preferences
made the screenshots byte-identical. Raw DOM uses structured namespaces,
attributes, styles and child nodes; attribute/declaration order is canonicalized.
Missing decorator/accessory wrappers remain real failures.

## Reviewed DOM exception policy

```json
{"approvedDOMExceptions":[]}
```

No raw DOM exception is active. Review evidence is
`parity-dom-allowlist-review.md`. Candidate native containment properties affect
geometry and have an explicit native browser assertion, so source search and an
empty screenshot do not establish an application-wide exception. The managed
trailing-BR attribute is a narrowly scoped candidate only; external extension
non-reliance is unproven. Its BR node, location and count must always remain.
Legacy decorator/accessory containers are UI features and cannot be exempted.

## Merge resolutions and outstanding gates

The41-hook merge retains shared state configuration through manual snapshot
clones, source-aware text-slice cloning, own JSON/export hooks exactly once
outside framework-only projection, active-graph public accessors, owned raw
record access, extracted replay frames and selection identities. Corpus/gate
and debug exports coexist. Dependency closures were regenerated from manifests.
The retired/published state maps are editor-scoped; remaining identity-owner,
record and selection namespace corrections are an explicit follow-up. Audit:
`audit-foreign41-merge.md`. No production consumer claim follows from compilation.

The hook merge preserves staged shared+conditional round rollback and isolated
per-hook rollback after their publication. Decline/error and queued/early
publication guards retain the99-round bound. Audit: `audit-shortcut-merge.md`.

Saved JSON downloads now call the cleaned native `savedState()` API;
`serializedState()` remains raw. Macro exports use the exact source transformers,
including inline mention quirks; generic exports retain builtin behavior.

Native Enter artifact:6,918,490 raw bytes; see `heading-enter-live-artifact.json`
for SHA and exact source. The prior shortcut artifact was6,904,479 raw /
1,581,464 Brotli; export artifact6,918,357 raw /1,585,096 Brotli. The build's
original1,130,000-byte gate still fails and is not waived. Size/perf decisions
remain deferred; compat perf is a separate hard gate on a quiet host.

Historical quiet-window T0 after owner recovery: seed9486392389341030173,
`final state changed during quiet window`. This is not a fresh final rerun.
Before the UI stop, coverage seed357 also failed all_docs_equal (a client missed
received server history). The final full T0 and matrix have not been rerun.

<details>
<summary>Earlier integration and native-preview evidence</summary>

# Rust editor integration — current rerun

Status: Integration 3 matrix stopped for UI parity priority; both remain unchecked.

The interrupted merge was checkpointed as `93e57479f6`. The latest sync
branch tip `fc8f1cf5b2` was then merged as `2e7f480ef1`. The earlier
private-history recovery fix `9343d0f641` remains included.

All 1,421 fixture conflicts changed only `source.recordedWith`; all other
bytes, including expected observations, are identical. The 570 gate ledger
entries retain existing values and add exact source-error evidence. Other
conflicts preserve generic asynchronous storage writes, owner/adoption
checks, strict decoder validation, separate current and legacy Loro peers,
and the provisional size cap. The source-only Nix packaging check now covers
every embedded patched vendor crate.

Fresh production build: 4,045,656 raw bytes; **1,120,466 Brotli bytes**.
The provisional cap is **1,130,000 bytes**; remaining margin is **9,534**.
Production optimization settings were not changed in this rerun.

All fresh Cargo invocations are limited to two jobs. Libtest uses one
thread; case counts remain full, including 256 property cases, 10,000 Tier C
steps and 2,000 collaboration steps. No fast mode or service-tier override.

The full matrix was stopped for UI parity work. Historical evidence is under
`/home/wolf/tmp/integration3-cap1130-j2/`, including exact command, exit,
duration and log names in `matrix.jsonl`. Failed first attempts remain
recorded alongside any corrected reruns. The earlier four-job T0 run failed
`graceful_close` (initial seed 3050571380339707603, minimized 0) and
`presence_expires` (minimized 0); these are historical results, not the
fresh two-job verdict.

The historical owner-recovery quiet-window failure was seed
9486392389341030173: `final state changed during quiet window`.
The latest full rerun must determine whether this or another invariant fails.

No deployment, production access, stash, branch rewrite, push or pull
request was performed. Only synthetic local test services are used.


## Priority enabled-editor preview merge

The full matrix was interrupted for the requested preview before its final
verdict; incomplete commands are not passes. `wolf/plugins-group-b` tip
`56bb6b4cc6` is integrated, including the flag and EditorView branches.

Seventeen conflict paths were resolved: application/session/sync/projection
and collaboration guides; both WASM/readme and differential documentation;
session editor, builder and test module declarations; Macro sync policy;
Loro version differential runner; persisted simulation seeds; dependency
hashes; regenerated WASM declarations; size script and S4 budget rows.
Both command-builder helpers, test modules and regression seeds remain.
Macro source own-undefined fields use null at storage boundaries and retain
omitted canonical editor aliases, preserving strict comparisons and Loro values.
The application session supplies its matching CommentNode constructor.
Dependency hashes use the incoming values provisionally, pending actual
post-merge install verification.

The production WASM compiled and declarations were regenerated. Raw size is
6,782,069 bytes; Brotli size is **1,552,476 bytes**. The unchanged provisional
1,130,000-byte gate therefore **fails by 422,476 bytes**. No size tuning or cap
increase was applied. Focused session and Lexical tests are running at two jobs.


Preview merge commit: `2563ee6a13`. The preview orchestrator was notified
immediately after commit. Frozen install passed (1,932 installs across 1,895
packages). Client production feature graph excludes composers, server crates,
Tokio, axum, SQLx, workspace-hack and Loro development utilities.

Conflict inventory for this merge:

| Path | Resolution |
| --- | --- |
| apps/web/AGENTS.md | Retain incoming provisional cap and startup measurement guidance. |
| apps/web/scripts/document-session-size.ts | Keep exact 1,130,000-byte cap and incoming provisional-budget comment. |
| crates/client/doc_sync_core/AGENTS.md | Remove duplicate whitespace; retain recovery rules. |
| crates/client/document_session/AGENTS.md | Retain cursor, IME, supplied annotation factory and both builder APIs. |
| crates/client/document_session/src/editor.rs | Export both builder helpers; retain undo observations, handled state and test faults. |
| crates/client/document_session/src/editor/builder.rs | Compose session identity tracking over the shared command helper once. |
| crates/client/document_session/src/test.rs | Retain annotation, IME and presence modules. |
| crates/client/document_session_wasm/README.md | Retain provisional cap and startup measurement wording. |
| crates/client/lexical/lexical_loro/AGENTS.md | Combine policy boundaries and document source-null canonicalization. |
| crates/client/lexical/lexical_loro/src/test/differential/runner.ts | Preserve current editor and frozen server version checks. |
| crates/client/lexical/macro_document_model/src/sync.rs | Separate catalog-driven wire nulls from canonical editor aliases. |
| crates/sync_sim/tests/random_sessions.regressions-2 | Retain both saved cases. |
| docs/design/lexical-port/S4-tests.md | Retain precise provisional cap and startup follow-up. |
| nix-support/node_modules-hashes.json | Incoming values provisionally; actual install verification pending. |
| packages/collaboration/AGENTS.md | Retain timer rearming and legacy-storage rules. |
| packages/collaboration/src/session/wasm.generated.d.ts | Regenerate from the actual merged production build. |
| packages/lexical-conformance/diff/README.md | Retain independent profiles and native prebuild guidance. |

Focused validation and the restarted full matrix use separate evidence under
`/home/wolf/tmp/integration3-preview-merge/` and
`/home/wolf/tmp/integration3-with-plugins/`. Passing focused checks are retained
as same-commit evidence; interrupted earlier commands are not credited.


The first merged mixed-version run exposed a storage/export boundary mismatch.
Storage encoding now restores source-undefined fields as null only at writes;
canonical editor JSON keeps its original precise omission rules. Initialization,
local diffs, new subtrees and full sync all use storage encoders. Read and attach
comparisons remain strict, and the TS comparator is unchanged. Three literal
null/table tests pass, including raw storage, canonical export and no-op full-sync
VV checks. Current and legacy mixed-version suites each pass9/9 after the fix.
The earlier full T0 remains a recorded failure and will be rerun on this correction.

## Shared document chrome checkpoint

`dd14a125eb` integrates engine-only component `cdb0859226`; both document
models now enter the existing Notebook/scroll/title/property/discussion/comment
margin hierarchy. MarkdownEditorChrome supplies the same body loading,
placeholder and error presentation. The native body remains lazy; only the
legacy engine creates LexicalWrapperContext and CollabProvider.

`b5ebeae724` integrates editing contract `e6a6ff1726` and connects title
Enter/Down/Right/Tab and the bottom focus target to native model-owned focus
operations. Native menus/toolbars/anchored comments remain under the engine
installer owner's work. No duplicate legacy model supplies native UI.

Validation uses `/home/wolf/tmp/editor-parity-validation`, with independent
node_modules and caches. TypeScript passed after the chrome change and again
after focus adapters; focused loading tests passed2/2. The flag-off static
build succeeded in118seconds. Own headless Chromium created separate local
synthetic documents and observed shared title, Add tags, Add property,
placeholder and Discussion in the enabled path. This is a smoke observation,
not a DOM/screenshot/Markdown parity pass.

The strict paired parity harness is in progress under
`apps/web/src/features/block-md/browser-test/parity`. It runs against enabled
preview24009 and a plain HTTPS static frontend39770 proxying the same local
backend. It uses its own synthetic account, browser and storage; onboarding
sent no invitations and disabled domain joining/notifications. The local stack
was neither restarted nor stopped. No live dependency/cache writes occurred.

Audit found two native export mismatches: Markdown's bulk export currently
uses builtin transformers rather than Macro external transformers, and JSON
download currently uses raw snapshot state rather than the saved-state cleanup.
The native engine owner is implementing external exports and an explicit
`savedState()` cold API. They remain failures until merged and verified.

Current parity table: shared chrome smoke observed; strict empty comparison
failed (DOM differences and3,807 screenshot pixels; empty Markdown equal); block/inline shortcuts, menus, paste variants, lists/checklists,
tables/code, comments/drag, undo/redo, persistence/collaboration pending.
No preview acceptance or full-matrix pass is claimed. Integration3 remains
unchecked. D5 size decisions/tuning remain deferred during this UI priority.


The first completed paired empty comparison used real Copy as markdown from
both applications. Both exported the empty string. Strict DOM and screenshot
checks failed; screenshot delta3,807pixels. Native root lacks the legacy md
class and white-space/user-select/word-break styles, native paragraph direction
is empty instead of auto, and decorator/accessory containers differ. The native
engine owner has this evidence. Initial harness attempts had menu-locator
failures; they are preserved separately and are not app parity results.

Local Tempo has current own-document editor.open traces with wasm.init,
state.load and view.reconcile present. Evidence:
`/home/wolf/tmp/integration3-acceptance/editor-open-own-evidence.json`.
Trace9089a8b198d5ae529ec7f92f54cf4f3d is one matching local synthetic open.
Incremental just check passed in the independent copy (two existing async-chain
warnings); TypeScript and the33-case Playwright collection pass. The broad
matrix remains stopped and no unrun case is counted as passing.

</details>
