# Migrate legacy access extractors to entity_access crate

## Context
We are removing legacy access extractors from `macro_middleware::cloud_storage::ensure_access` and replacing them with the new versions from `entity_access::inbound::axum_extractors`.

## Pattern
The old extractors had one generic param, the new ones have two (adding `Svc: EntityAccessService`):
- **Old**: `{Entity}AccessExtractor<T>` from `macro_middleware::cloud_storage::ensure_access::{entity}`
- **New**: `{Entity}AccessExtractor<T, Svc>` from `entity_access::inbound::axum_extractors`

### Migration steps per file:
1. Replace import: `macro_middleware::cloud_storage::ensure_access::{entity}::{Extractor}` → `entity_access::inbound::axum_extractors::{Extractor}`
2. Add import for the concrete `EntityAccessService` type alias (crate-specific)
3. Add second generic param: `Extractor<AccessLevel>` → `Extractor<AccessLevel, EntityAccessService>`
4. If handler accesses `.access_level` field: extract from `receipt.entity_access_receipt.entity_permission()` instead (match on `EntityPermission::AccessLevel { access_level }`)
5. Add access param to `tracing::instrument(skip(...))` since `EntityAccessServiceImpl` doesn't impl `Debug`
6. Prefix unused access params with `_` (warnings are errors via `-Dwarnings`)
7. Ensure `entity_access` dep in Cargo.toml has `"inbound"` feature
8. If the crate's `ApiContext` doesn't have `entity_access_service: Arc<EntityAccessService>`, add it (needed for `FromRef`)

## Completed
- [x] Document extractors in `document_storage_service` (19 files)
- [x] Chat extractors in `document_cognition_service` (1 file + ApiContext update)
- [x] Project extractors (done by user manually)

## In Progress
- [ ] Fix remaining compilation errors from project extractor migration
