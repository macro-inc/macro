# Rust editor integration: production compatibility checkpoint

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
