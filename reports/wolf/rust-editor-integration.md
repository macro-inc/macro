# Rust editor integration: production compatibility checkpoint

## Current checkpoint: coherent configuration, priority WAL recovery and open metadata gates

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
The three central exceptions retain their budget; helper SHA256 is
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
and full view types pass. The complete suite is **197 passed / 4 failed** of 201,
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
The latest complete shim run is **198/202**, with the same four failures and
one unhandled raw-cache error; full source/hook and full view checks pass.
Evidence is in `dom-probe-*` logs. Source artifacts were rebuilt in the
disposable tree without changing compiler options. The independent source audit
(`audit-native-abi2-source-checkpoint.md`) found no new source defect and verified
the archived WASM/DTS hashes. The advisory ceiling overage is435,592 bytes;
initializer, native oracle, positive cache/crossing and parity gates remain open.

The OFF inventory continuation through `65fa6cf3b0` is integrated, including code,
table picker, checkbox/task conversion, link and mounted TaskList fixtures. Owner browser evidence
is 114/114 code, 132/132 table and 153/153 link OFF cases, each across three
viewport profiles; these are not native mobile/virtual-keyboard proofs. The exact
ledger has 698 selectors across four explicit reports (full web22,440, media36,
conversion11, TaskList19), including 448 new editor units; it is not a summed
full-suite run, deduplicated behavior count or ON acceptance. The 19-case TaskList
report replaces the earlier 12-case report. No duplicate broad OFF run was
launched here. TaskList commits `16d9f311d3` / `65fa6cf3b0` are integrated as
`09635f91a7` / `23aab1afdc`; the independent disposable checkout passes all
19 focused tests, and scoped `just check` passes. Mounted inherited ListNode
hooks cover kind transitions and ordered-start identity, not native/custom-class
hosting or the actual controls UI. Production declaration-oracle hooks and the
resolver remain held.

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
