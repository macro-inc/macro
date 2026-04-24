# Implementing an Attachment Service

You are adding an `inbound/attachment` module to a domain crate. This module implements the `attachment::AttachmentService` trait so the crate can resolve its entity IDs into AI-consumable attachment content.

## Context files to read first

Read these files in order to understand the patterns:

1. `attachment/src/lib.rs` — the `AttachmentService` trait and `Attachable` trait
2. `attachment/src/models.rs` — `AttachmentContent`, `AttachmentPart`, `Attachments`, `ResolutionError`, `AttachmentError`
3. `attachment/src/fmt.rs` — `XmlTag`, `ClosedXmlTag`, `Indent` formatting utilities
4. `attachment/src/attachable.rs` — `Attachable` impls that convert the attachment tree into `FormattedParts`
5. `documents/src/inbound/attachment/` — reference implementation (module structure, service, markdown submodule)
6. `chat/src/inbound/attachment/service.rs` — example using `fmt::XmlTag` for structured message formatting

All paths are relative to `rust/cloud-storage/`.

## What you're building

A struct that implements `AttachmentService`:

```rust
pub trait AttachmentService: Send + Sync + 'static {
    fn resolve_attachments(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&str]>,
    ) -> impl Future<Output = Attachments> + Send;
}
```

It takes entity IDs and returns `Attachments` — a non-empty vec of `Result<AttachmentContent, ResolutionError>`. Individual failures never fail the batch.

## Key types

- `AttachmentReference` — typed enum identifying the source entity (`DssFile`, `SfsImage`, `EmailThread`, `Chat`, `Channel`). Produces XML attributes via `as_attributes()`.
- `AttachmentContent { reference: AttachmentReference, name: Option<String>, content: NonEmpty<Vec<AttachmentPart>> }` — a resolved attachment
- `AttachmentPart::Content(String)` — text content
- `AttachmentPart::Image(ImageData)` — image data (from `ai::types::ImageData`)
- `AttachmentPart::Child(Box<Result<AttachmentContent, ResolutionError>>)` — nested sub-attachment with its own `AttachmentReference`
- `AttachmentPart::ChildReference(AttachmentReference)` — unresolved reference to a child attachment
- `AttachmentPart::Metadata { key, value }` — key-value metadata (formatted as `<metadata key="..." value="..."/>`)
- `ResolutionError::new(id, AttachmentError)` — a per-attachment failure
- `Attachments::new(NonEmpty<Vec<Result<AttachmentContent, ResolutionError>>>)` — the batch result

### Formatting types (`attachment::fmt`)

- `XmlTag { name, attrs, body }` — wraps body content in `<name attrs>...</name>`. Implements both `Display` (for producing `String`) and `Attachable` (for producing `FormattedParts` with images preserved).
- `ClosedXmlTag { name, attrs }` — self-closing `<name attrs/>`. Use for metadata and unresolved references.
- `Indent(T)` — indents all text lines of the wrapped value.

## Steps

### 1. Add dependencies to the crate's Cargo.toml

Add an `attachment` feature that pulls in what you need:

```toml
[features]
attachment = [
    "dep:attachment",
    # add other deps your resolver needs (dep:ai, dep:reqwest, etc.)
    "ports",  # if the crate gates its domain traits behind a feature
]

[dependencies]
attachment = { path = "../attachment", optional = true }
non_empty = { path = "../non_empty" }
```

### 2. Wire up the inbound module

In `src/inbound.rs` (or equivalent), add:

```rust
#[cfg(feature = "attachment")]
pub mod attachment;
```

Make sure `lib.rs` compiles the `inbound` module when the `attachment` feature is active.

### 3. Create the module structure

```
src/inbound/attachment/
├── mod.rs      — declares submodules, re-exports the service struct
└── service.rs  — the AttachmentService implementation
```

Add more files if you need type-specific resolution logic (like `markdown.rs` in the documents reference impl).

### 4. Implement the service

Your service struct holds `Arc` references to whatever domain services and clients it needs. Follow this pattern:

```rust
pub struct FooAttachmentService<Svc> {
    service: Arc<Svc>,
}

impl<Svc: FooService> AttachmentService for FooAttachmentService<Svc> {
    async fn resolve_attachments(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&str]>,
    ) -> Attachments {
        let user_id = &user_id;
        let results = join_all(ids.iter().map(|id| async move {
            self.resolve_one(user_id, id)
                .await
                .map_err(|error| ResolutionError::new(id.to_string(), error))
        }))
        .await;
        Attachments::new(NonEmpty::new(results).expect("ids was non-empty"))
    }
}
```

Then implement `resolve_one` which returns `Result<AttachmentContent, AttachmentError>` for a single entity. This is where the domain-specific logic lives.

### 5. Add the `AttachmentReference` variant

If your entity type doesn't have a variant in `AttachmentReference` yet, add one in `attachment/src/models.rs`. Update `id()`, `as_attributes()`, and the `AttachmentProvider` router in `provider.rs`.

### 6. Register with the provider

Add your service as a type parameter to `AttachmentProvider` in `attachment/src/provider.rs` and wire up the dispatch.

## Conventions

- Use `join_all` to resolve IDs concurrently.
- Map domain errors to `AttachmentError::Internal(e.into())` unless a more specific variant fits (`PermissionDenied`, `UnknownFileType`, `UnsupportedFileType`, `NoContent`).
- Access-check each entity via `EntityAccessService::generate_entity_access_receipt` before reading content.
- Use `tracing::instrument` on `resolve_one` with `skip(self)` and `err`.
- Use `attachment::fmt` utilities (`XmlTag`, `ClosedXmlTag`) for structured text formatting (e.g. wrapping messages in `<message role="user">` tags). Use `XmlTag.to_string()` when producing an `AttachmentPart::Content(String)`.
- For sub-attachments (e.g. inline images within a document), use `AttachmentPart::Child` with the appropriate `AttachmentReference` variant. This flows through the `Attachable` formatting system and produces properly tagged XML output.

### NonEmpty rules

**Never insert empty or placeholder strings into `NonEmpty` to satisfy the non-empty constraint.** The `NonEmpty<Vec<AttachmentPart>>` in `AttachmentContent.content` means "this attachment has content." If resolution produces zero parts, return `AttachmentError::NoContent` instead.

```rust
// WRONG — defeats the purpose of NonEmpty
let content = NonEmpty::new(parts).unwrap_or_else(|_| {
    NonEmpty::new(vec![AttachmentPart::Content(String::new())]).expect("single element")
});

// RIGHT — signal that this attachment has no content
let content = NonEmpty::new(parts).map_err(|_| AttachmentError::NoContent)?;
```
