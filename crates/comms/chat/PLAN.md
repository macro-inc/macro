# User-Level Resolved Attachments — Integration Plan

## Problem

- All explicit attachments are "system level" — they're fetched once at request time and injected into the system prompt or as images on the last user message. They die on detach, AI can't see changes on re-send.
- Attachment fetching uses the old scribe crate which should be killed in favor of the hex crates.
- AI can't see images in attached markdown docs or PDFs.

## What's Done

1. **`attachment` crate** — `Attachments`, `AttachmentContent`, `AttachmentPart`, `TextOrImage`, `Attachable` trait, `AttachmentService` trait, XML formatting.
2. **`ai` crate** — `ChatMessage.attachments: Option<Attachments>`, builders updated, OpenAI provider formats attachments via `Attachable::into_formatted_parts().compact()` into text+image content parts on the user message.

## What's Broken Right Now

`fetchium()` in DCS returns `Vec<ai::types::Attachment>` — a type that no longer exists. `ai_request.rs` calls `.attachments(attachments)` on `RequestBuilder` which now expects `attachment::Attachments`. DCS won't compile against the updated `ai` crate.

---

## Phase 1: DB Migration

Add a `ResolvedUserMessage` table that stores the AI-facing representation of user messages.

```sql
CREATE TABLE "ResolvedUserMessage" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "messageId" TEXT NOT NULL REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
    "content" JSONB NOT NULL,  -- Vec<UserMessageContent> serialized
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE("messageId")
);
```

The `content` column stores resolved parts: `[{type: "text", ...}, {type: "image", ...}, {type: "attachment", name: "...", parts: [...]}]`.

---

## Phase 2: Domain Types in Chat Crate

Add resolved message content types to `chat/src/domain/models.rs`:

```rust
enum ImageContent {
    StaticUrl(String),
    Base64(String),
}

enum UserMessageContent {
    Text(String),
    Image(ImageContent),
    Attachment { name: String, parts: Vec<UserMessageContent> },
}

struct ResolvedUserMessage {
    message_id: String,
    content: Vec<UserMessageContent>,
}
```

These are the chat crate's own domain types. The chat crate defines `From<ResolvedUserMessage>` → `ai::types::ChatMessage` to bridge into the AI crate.

The conversion:
- `UserMessageContent::Text(s)` → text content part
- `UserMessageContent::Image(img)` → image content part
- `UserMessageContent::Attachment { name, parts }` → formatted as `<attachment><title>name</title><content>...</content></attachment>` text

---

## Phase 3: Attachment Resolution Port

Add a new port to the chat crate (or a standalone trait):

```rust
trait AttachmentResolver: Send + Sync + 'static {
    fn resolve(
        &self,
        user_id: MacroUserIdStr<'_>,
        message_text: &str,
        attachments: Vec<AttachmentReference>,
    ) -> impl Future<Output = Result<Vec<UserMessageContent>>> + Send;
}
```

This replaces `fetchium()`. The implementation:

1. For each attachment reference, dispatch by type (document, image, channel, email, project)
2. **Documents**: fetch content via the existing `AttachmentService` infra (the hex-pattern services built for `ReadTool`)
3. **Markdown documents**: call the lexical service's new `parseMdWithImages` endpoint → ordered `[text, image, text, ...]` parts
4. **Images in markdown**: fetch from SFS, downscale via `ImageData::try_from_bytes()`, encode as base64
5. **Standalone images**: same as above
6. **Channels/email/projects**: existing text-only resolution (same logic as current `fetchium`)
7. Return `Vec<UserMessageContent>` preserving part order

---

## Phase 4: Lexical Service — `parseMdWithImages`

New endpoint in the lexical (JS) service:

```typescript
type MdPart =
  | { type: "text"; content: string }
  | { type: "image"; id: string }
  | { type: "static_image"; url: string };

// POST /parse-md-with-images
function parseMdWithImages(document_id: string): MdPart[];
```

Parses the lexical document tree, extracts inline image nodes (with their document IDs or static URLs), returns an ordered list of text and image parts. Adjacent text nodes should be merged.

---

## Phase 5: Resolved Message Storage

Add to `ChatRepo`:

```rust
fn store_resolved_message(
    &self,
    message_id: &str,
    content: &[UserMessageContent],
) -> impl Future<Output = Result<(), ChatErr>> + Send;

fn get_resolved_message(
    &self,
    message_id: &str,
) -> impl Future<Output = Result<Option<Vec<UserMessageContent>>, ChatErr>> + Send;
```

Insert resolved content after attachment resolution completes. The resolved message is the source of truth for the AI provider — it contains all the text and base64 images inline.

---

## Phase 6: Wire Into DCS Message Send Flow

Update `send_chat_message()` in DCS:

```
1. Store user message (unchanged — raw text + attachment refs)
2. Resolve attachments → Vec<UserMessageContent>
3. Store resolved message in new table
4. Build AI request from resolved message (not from raw attachments)
5. Stream AI response (unchanged)
```

Replace `build_chat_completion_request()`:
- Remove `fetchium()` call
- Build the user message from the resolved content instead
- The resolved content already has text + images inline, so no system-prompt injection needed

---

## Phase 7: Re-Resolve on Message Edit

When a user edits a message, re-run attachment resolution and update the resolved message row. The cascade delete on the FK handles the case where the raw message is deleted.

---

## Phase 8: Kill `fetchium` + Old Types

Once the new flow is wired:

1. Delete `service/attachment/fetch.rs` (`fetchium`)
2. Remove `ai::traits::TextAttachment` re-export (update `ai_tools` rewrite tool)
3. Remove `PromptAttachments` if system prompt no longer carries attachment text
4. Remove scribe-based attachment fetching from DCS

---

## Phase 9: Frontend Changes

- Attachments from DND, upload, and `@` mention all append to an attachment list on the message
- DND/upload attachments show in the visible attachment bar above input
- `@` mentions are in the message text but also in the attachment list
- Frontend sends `attachments: [{type: "document", id: "..."}, ...]` alongside message content
- No more lexical service mention parsing on the backend — the frontend already knows what was mentioned
- Makes `snapshotNode` obsolete

---

## Phase 10: Backfill Script

For existing user messages that have no resolved counterpart:

```
for each user message without a ResolvedUserMessage row:
    insert ResolvedUserMessage with content = [{type: "text", content: message_text}]
```

This is lossy (old attachments were system-level and not preserved per-message), but correct — old messages get their text content as the resolved form. Run per-env: local, dev, prod.

---

## What This Makes Obsolete

- `fetchium()` / `service/attachment/fetch.rs`
- `ai::traits::TextAttachment` re-export
- `PromptAttachments` / system prompt attachment injection
- `snapshotNode` in the frontend
- The scribe-based attachment fetching pattern in DCS

## Implementation Order

```
Phase 2 (domain types)          ─┐
Phase 1 (migration)             ─┼─→ Phase 5 (storage) ─┐
Phase 4 (lexical parseMdImages) ─┤                       ├─→ Phase 6 (wire DCS) ─→ Phase 7 (re-resolve)
Phase 3 (resolution port)       ─┘                       │                        → Phase 8 (cleanup)
                                                         │
Phase 10 (backfill)            ←─────────────────────────┘
Phase 9 (frontend)             ← can start after Phase 6, parallel with 7-8
```
