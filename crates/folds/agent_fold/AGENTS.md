# agent_fold

## What it is

Core to the agent sessions feature: collapses an agent session's raw ACP/ARP
protocol log into the renderable message vocabulary every caller (harness,
web, exports) reads sessions through. Builds native (`rlib`) and as wasm
(`cdylib`) for the browser.

## How it works

Raw log frames (`domain/log.rs`) go in; `domain/fold.rs` folds them, handling
lifecycle and speculative state, and always succeeds (unaccounted frames are
logged, not errored); `domain/model.rs` renderable messages come out, exposed
to the browser via `inbound/wasm`.

## Start here

- `src/domain/fold.rs`: the fold itself — read its module doc first; it's
  total by design (see "Why this cannot fail") and never errors on read.
- `src/domain/model.rs`: the renderable vocabulary (`FoldedMessage`,
  `ToolStatus`, …) folds produce.
- `src/domain/log.rs`: the raw log vocabulary folds consume.
- `src/domain/ports.rs`: `FoldedMessageRepo`, the driving port services call
  directly — there is no HTTP adapter; only the browser gets `inbound/wasm`.
- `src/testing/fixtures.rs` + `fixtures/`: hand-shaped and sanitized real
  recordings shared by this crate's and downstream tests.

## Scope

- Owns: the fold, its model/log vocabularies, lifecycle and speculation
  folding, and the wasm/wire adapters that carry the model to the browser.
- Not here: per-harness quirks (Claude/Codex-specific normalization) →
  `crates/folds/claude_fold`, `crates/folds/codex_fold`.

## Boundaries

- Depends on: `agent_runtime_protocol` (schema only, `default-features =
  false` — no transport, which is what makes wasm possible).
- Used by: `agent_harness_service`, `agent_session`, `agent_harness`,
  `coding_agent_worker`, `lexical_client`, `agent_changes`, `webhook`, and both
  harness-specific fold crates. Widely shared — check callers before changing
  `domain/model.rs` or `domain/ports.rs`.

## Recipes

- Add a new message/event kind: `src/domain/log.rs` (raw shape) →
  `src/domain/fold.rs` (fold logic) → `src/domain/model.rs` (renderable type)
  → `src/inbound/wire.rs` if the browser needs it → `cargo run -p agent_fold
  --bin export_types` to regenerate the TypeScript contract.
- Debug a fold against a recorded session: `cargo run -p agent_fold --bin
  fold_jsonl -- <path>.jsonl`.

## Checks

- `cargo test -p agent_fold`.
- After changing `inbound/wire.rs` or exported `domain/model.rs` types:
  `cargo run -p agent_fold --bin export_types` and commit the regenerated
  TypeScript.

## Gotchas

- A frame the fold can't account for is logged at `WARN` via `FoldError`, not
  returned as an error — `fold` must stay total (see `domain/fold.rs` docs).
- `scripts/sanitize_recording.py` strips real-session fixtures before they
  land under `fixtures/real/`; never commit an unsanitized recording.

## Related

- Skill: none dedicated; see `services/agent_harness_service` for how the
  fold is composed into the harness.
