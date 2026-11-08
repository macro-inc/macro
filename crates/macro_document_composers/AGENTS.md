# Macro document composers

## What it is

Server-side prompt, announcement, reply and generated-image Markdown composition.
Portable document nodes, mentions, XML and Markdown machinery live in macro_document_model.

## Start here

- `src/context.rs`: typed native requests using trigger_context directly.
- `src/wire_trigger.rs`: string-preserving endpoint mirrors generated from trigger_context.
- `src/context_wire/`: exact source context renderers and corpus-only legacy fields.
- `src/replies.rs`, `image.rs`: node-authored reply and image composition.
- `src/wire.rs`: endpoint validation and response mirrors.

## Boundaries

- Keep typed TriggerContext dependencies native-only; only the development conformance harness depends on the source-wire replay.
- Expose portable source-wire replay on development WASM targets without server domain dependencies.
- Reject legacy conversation fields in current endpoint parsing; retain their source behavior only for strict corpus replay.
- Reuse the model XML builder, Markdown engine, node constructors and explicit DocumentContext.
- Preserve wire scalar serialization and source field order, including unknown activity-card fields.
- Keep context untrusted and make no authorization, persistence, clock, entropy or network calls.
- Keep workspace-hack native-only while retaining normal server hakari membership.

## Checks

- `TMPDIR=/home/wolf/tmp cargo test -p macro_document_composers -j4`
- `TMPDIR=/home/wolf/tmp cargo test -p lexical_conformance --test replay -j4`
- `TMPDIR=/home/wolf/tmp cargo check -p macro_document_composers --target wasm32-unknown-unknown -j4`
- `TMPDIR=/home/wolf/tmp cargo clippy -p macro_document_composers --all-targets -j4 -- -D warnings`
- `cargo tree -p macro_document_model --target wasm32-unknown-unknown -e normal -i trigger_context` prints nothing.
- `bun packages/lexical-conformance/corpus/composer-wire.ts --check`
- `bun packages/lexical-conformance/corpus/macro-composers.ts --check`
- `cargo x deps --check`, `just check`, `just pr-privacy`
