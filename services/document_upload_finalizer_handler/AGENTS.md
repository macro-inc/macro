# document_upload_finalizer_handler

## What it is

Documents feature: Lambda that finalizes a document upload after the object
lands in S3 — resolves file type, upgrades legacy Office formats, and
initializes markdown content.

## Start here

- `src/lib.rs`: module overview — production runs through the EventBridge
  adapter, local dev through a LocalStack SQS poller; both normalize into
  `app::ObjectCreated` and call the same use case.
- `src/app.rs` + `src/app/tests.rs`: `DocumentUploadFinalizer` use case (hexagonal
  core) and its tests.
- `src/ports.rs`: inbound ports the use case depends on (`DocumentUploadMetadataPort`,
  `DocumentObjectReader`).
- `src/inbound/`: `eventbridge.rs` (prod), `local_sqs.rs` (local), `s3_notification.rs`.
- `src/outbound.rs` + `src/outbound/tests.rs`: concrete adapters (S3, document ports).
- `src/bin/local_worker.rs`: standalone binary for local SQS polling.

## Scope

- Owns: turning an S3 object-created event into a finalized document (file type
  detection, legacy Office/`.xlsm` upgrade via `documents::domain::legacy_office_upgrade`,
  markdown initialization).
- Not here: text/citation extraction from the finalized document →
  `document_text_extractor`; the docx-specific unzip/BOM pipeline →
  `docx_unzip_handler`.

## Boundaries

- Depends on: `documents` (domain use cases/ports), `bots`, `lexical_client`,
  `sync_service_client`, `entity_registry`/`entity_registry_db_utils`.
- Used by: triggered by S3 `ObjectCreated` via EventBridge in production.

## Recipes

- Add a new upgraded office format: `s3_key::UpgradedOfficeFormat` →
  `src/app.rs` (`upgraded_file_type`) → `documents::domain::legacy_office_upgrade`.
- Change what counts as "finalized": `src/app.rs` (`DocumentUploadFinalizer`) →
  `src/ports.rs` if a new capability is needed → `src/outbound.rs`.

## Checks

- `cargo test -p document_upload_finalizer_handler` (`SQLX_OFFLINE` unset).

## Related

- Skill: `new-service`
