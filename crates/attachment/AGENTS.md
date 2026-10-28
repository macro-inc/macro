# attachment

## What it is

Part of AI: the shared contract for turning a reference to any entity (a
document, a channel message, a calendar event) into AI-consumable content,
so AI tools and attachments behave the same way across every domain. No
dependency on any domain crate.

## Start here

- `src/lib.rs`: the `AttachmentService` and `Attachable` traits.
- `src/models.rs`: `AttachmentContent`, `AttachmentPart`, `AttachmentReference`,
  `Attachments`, `FormattedParts`.
- `src/fmt.rs`: XML formatting (`XmlTag`, `ClosedXmlTag`, `Indent`) used by `Attachable` impls.
- `src/provider.rs`: `AttachmentProvider` router (feature `provider`), dispatching
  `AttachmentReference` variants to per-domain services.

## Scope

- Owns: the `AttachmentService`/`Attachable` trait contracts and shared formatting
  types used to turn entities into AI context.
- Not here: resolving a specific entity type — each domain crate implements
  `AttachmentService` in its own `inbound/attachment/` module (e.g. `crates/chat`,
  `crates/channels`, `crates/documents`, `crates/email`).

## Boundaries

- Depends on: `macro_user_id`, `model-entity`, `non_empty`.
- Used by: `channels`, `email`, `ai_tools`, `agent`, `agent_inmem`, `static_file`,
  `chat`, `documents`, `image_generation` — each implementing `AttachmentService`.

## Recipes

- Add a new attachable entity type: implement `AttachmentService` in the owning
  domain crate's `inbound/attachment/` module → add the `AttachmentReference`
  variant in `src/models.rs` → wire it into `src/provider.rs` (if used behind the
  router) → implement `Attachable` for the new content type in `src/attachable.rs`.

## Checks

- `cargo test -p attachment` (`SQLX_OFFLINE` unset).

## Gotchas

- `AttachmentContent.content` is `NonEmpty<Vec<AttachmentPart>>` — never insert a
  placeholder to satisfy the non-empty constraint; return `AttachmentError::NoContent`
  if resolution produces zero parts.
- Individual resolution failures surface as `ResolutionError` entries in the
  `Attachments` batch; they never fail the whole batch.

## Related

- Rules: `.agents/rules/rust/architecture.md` · Skill: `WRITE_ATTACHMENT_SERVICE`
  (`.claude/skills/` here) for implementing a new domain's `AttachmentService`.
