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

- `cargo test -p channel_labels --features postgres` (`SQLX_OFFLINE` unset).
- `SQLX_OFFLINE=true cargo check -p channel_labels --all-features`.

## Gotchas

- Omitted scope selects team for members and personal otherwise; explicit personal labels accept visible team, public, and private channels, never DMs.
- Every team member sees the same team labels in the same order; only per-member
  channel *visibility inside* a label differs — don't make label ordering
  per-user.
- Team labels remain restricted to channels in the same team; personal labels require active channel membership.
- `/channel-sections` reuses label storage through `for_sections` constructors; sections use either explicit picks or a name rule, and applying a rule atomically replaces the picks.
- Sections expose unjoined team channels only within the verified team scope. Legacy labels and previews remain participant-only; legacy smart-tag writes stay read-only.

- PATCH `{label_id}` accepts optional `targetScope: "personal" | "team"` with
  the existing `name` and optional `rule`; omission keeps rename behavior.
  Transferring a section preserves its ID and contents, but rejects any member
  the actor cannot access or the destination cannot label. Conflicting manual
  destination assignments move to the transferred section atomically.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
