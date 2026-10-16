# channel_labels

## What it is

Part of Chat: shared or private named groups of chat channels shown in the
Chat sidebar, following the standard hexagonal crate layout.

## Start here

- `src/domain/service.rs` + `src/domain/models.rs`: label CRUD, smart-tag
  matching, and ordering policy — read the module doc comment in `src/lib.rs`
  first for the sharing/visibility rules.
- `src/outbound/pg_channel_labels_repo.rs`: Postgres repository.
- `src/inbound/axum_router.rs`: HTTP routes.

## Scope

- Owns: manual and smart channel labels, their team-wide ordering, and per-member
  channel visibility within a label.
- Not here: the channels/messages themselves → `crates/channels`.

## Boundaries

- Depends on: `entity_access` (ports), `macro_authorization` (feature `inbound`), `cowlike`.
- Used by: `services/document_storage_service`, its composition root.

## Recipes

- Add a label field or smart-tag rule: `src/domain/models.rs` → `src/domain/service.rs`
  → `src/outbound/pg_channel_labels_repo.rs` → `src/inbound/axum_router.rs`.

## Checks

- `cargo test -p channel_labels` (`SQLX_OFFLINE` unset).

## Gotchas

- Every team member sees the same labels in the same order; only per-member
  channel *visibility inside* a label differs — don't make label ordering
  per-user.
- Labels are restricted to team channels (#6801) — don't extend them to
  non-team channels without revisiting that fix.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
