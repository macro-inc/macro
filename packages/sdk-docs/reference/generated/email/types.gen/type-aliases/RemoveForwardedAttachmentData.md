# Type Alias: RemoveForwardedAttachmentData

> **RemoveForwardedAttachmentData** = \{ `body?`: `never`; `path`: \{ `attachment_id`: `string`; `id`: `string`; \}; `query?`: `never`; `url`: `"/email/drafts/{id}/forwarded-attachments/{attachment_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `attachment_id`: `string`; `id`: `string`; \} | - |
| `path.attachment_id` | `string` | The ID of the forwarded attachment to remove. |
| `path.id` | `string` | The ID of the draft to remove the forwarded attachment from. |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/email/drafts/{id}/forwarded-attachments/{attachment_id}"` | - |
