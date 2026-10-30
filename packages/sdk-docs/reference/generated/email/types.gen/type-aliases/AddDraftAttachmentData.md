# Type Alias: AddDraftAttachmentData

> **AddDraftAttachmentData** = \{ `body`: [`AddDraftAttachmentRequest`](AddDraftAttachmentRequest.md); `path`: \{ `id`: `string`; \}; `query?`: \{ `draft_generation?`: `number`; \}; `url`: `"/email/drafts/{id}/attachments"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`AddDraftAttachmentRequest`](AddDraftAttachmentRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | The ID of the draft to add the attachment to. |
| <a id="property-query"></a> `query?` | \{ `draft_generation?`: `number`; \} | - |
| `query.draft_generation?` | `number` | Generation from the last loaded draft. Legacy clients use zero. |
| <a id="property-url"></a> `url` | `"/email/drafts/{id}/attachments"` | - |
