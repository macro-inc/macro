# attachment

Shared crate that defines the `AttachmentService` trait and supporting types for resolving entity references into AI-consumable content.

## Architecture

This crate has two roles:

1. **Trait definition** — `AttachmentService` and `Attachable` in `lib.rs`
2. **Provider router** — `AttachmentProvider` (behind the `provider` feature) dispatches `AttachmentReference` variants to per-domain `AttachmentService` implementations

Domain crates (documents, chat, email, comms) each implement `AttachmentService` in their own `inbound/attachment/` module. This crate does not depend on any domain crate.

## Module map

- `lib.rs` — `AttachmentService` trait, `Attachable` trait
- `models.rs` — `AttachmentContent`, `AttachmentPart`, `AttachmentReference`, `AttachmentError`, `Attachments`, `FormattedParts`, `TextOrImage`
- `fmt.rs` — XML formatting utilities (`XmlTag`, `ClosedXmlTag`, `Indent`) used by `Attachable` impls and by domain crates directly
- `attachable.rs` — `Attachable` impls for all model types; converts the attachment tree into `FormattedParts`
- `macros.rs` — `non_empty_collection!` macro for newtype wrappers around `NonEmpty<Vec<T>>`
- `provider.rs` — `AttachmentProvider` router (feature-gated behind `provider`)

## Key rules

- `AttachmentContent.content` is `NonEmpty<Vec<AttachmentPart>>`. Never insert empty or placeholder strings to satisfy the non-empty constraint. If resolution produces zero parts, return `AttachmentError::NoContent`.
- Use `AttachmentReference` variants to identify the source entity. The `Attachable` impl for `AttachmentContent` calls `reference.as_attributes()` to produce XML tags via `fmt::XmlTag`.
- Use `AttachmentPart::Child` with the appropriate `AttachmentReference` for sub-attachments (e.g. inline images within a markdown document). This flows through the `Attachable` formatting system.
- Use `fmt::XmlTag` / `fmt::ClosedXmlTag` for structured text formatting within attachment services (e.g. wrapping chat messages, channel messages).
- Individual resolution failures surface as `ResolutionError` entries in the `Attachments` batch — they never fail the entire batch.
