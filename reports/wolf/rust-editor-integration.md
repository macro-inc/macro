# Rust editor integration — current rerun

Status: validation in progress; Integration 3 remains unchecked.

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

The full matrix is running. Evidence is under
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
Macro source own-undefined aliases canonicalize to their source null form on
both sides, preserving strict comparisons and all underlying Loro values.
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
| crates/client/lexical/macro_document_model/src/sync.rs | Use catalog-driven source nulls consistently on model and persisted reads. |
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
