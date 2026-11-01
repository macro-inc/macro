# Type Alias: RemoveDraftAttachmentData

> **RemoveDraftAttachmentData** = \{ `body?`: `never`; `path`: \{ `attachment_id`: `string`; `id`: `string`; \}; `query?`: \{ `draft_generation?`: `number`; \}; `url`: `"/email/drafts/{id}/attachments/{attachment_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `attachment_id`: `string`; `id`: `string`; \} | - |
| `path.attachment_id` | `string` | The ID of the attachment to remove. |
| `path.id` | `string` | The ID of the draft to remove the attachment from. |
| <a id="property-query"></a> `query?` | \{ `draft_generation?`: `number`; \} | - |
| `query.draft_generation?` | `number` | Generation from the last loaded draft. Legacy clients use zero. |
| <a id="property-url"></a> `url` | `"/email/drafts/{id}/attachments/{attachment_id}"` | - |
