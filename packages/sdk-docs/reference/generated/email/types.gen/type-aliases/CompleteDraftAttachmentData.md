# Type Alias: CompleteDraftAttachmentData

> **CompleteDraftAttachmentData** = \{ `body?`: `never`; `path`: \{ `attachment_id`: `string`; `id`: `string`; \}; `query?`: \{ `draft_generation?`: `number`; \}; `url`: `"/email/drafts/{id}/attachments/{attachment_id}/complete"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `attachment_id`: `string`; `id`: `string`; \} | - |
| `path.attachment_id` | `string` | - |
| `path.id` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `draft_generation?`: `number`; \} | - |
| `query.draft_generation?` | `number` | Generation from the last loaded draft. Legacy clients use zero. |
| <a id="property-url"></a> `url` | `"/email/drafts/{id}/attachments/{attachment_id}/complete"` | - |
