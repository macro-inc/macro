# dictation

## What it is

Backs voice dictation in document and chat composers: private, transient
audio transcription that validates a recording, transcribes it via Whisper,
and returns text — nothing is stored.

## Start here

- `src/domain/service.rs`: the transcription use case (`DictationServiceImpl`).
- `src/domain/models.rs`: `Recording`/`Transcript` value objects and limits
  (`MAX_AUDIO_BYTES`, `MAX_AUDIO_DURATION`).
- `src/domain/ports.rs`: `TranscriptionProvider` / `RecordingInspector` traits.
- `src/outbound/whisper.rs`: the OpenAI Whisper adapter.
- `src/inbound/axum_router.rs`: the authenticated, rate-limited HTTP endpoint.

## Scope

- Owns: recording validation, format/duration limits, and the HTTP endpoint
  used by `document_storage_service`'s composers.
- Not here: AI usage accounting (`ai_usage`, a dependency) or any persisted
  transcript storage — this crate does not persist audio or text.

## Boundaries

- Depends on: `ai_usage`, `macro_authorization` + `rate_limit` (inbound
  feature), `async-openai` + `opus-pure`/`symphonia` (outbound feature).
- Used by: `document_storage_service`.

## Recipes

- Swap or tune the transcription provider: `src/outbound/whisper.rs` →
  `src/domain/ports.rs` (if the port signature changes) → its `test.rs`.
- Change validation limits: `src/domain/models.rs` → `src/domain/service.rs`.

## Checks

- `cargo test -p dictation --features inbound,outbound` (no database; pure
  unit/HTTP tests with `wiremock`).

## Related

- Rules: `.agents/rules/rust/architecture.md`
