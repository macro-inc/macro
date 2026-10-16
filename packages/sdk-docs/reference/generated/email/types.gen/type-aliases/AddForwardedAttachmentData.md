# Type Alias: AddForwardedAttachmentData

> **AddForwardedAttachmentData** = \{ `body`: [`AddForwardedAttachmentRequest`](AddForwardedAttachmentRequest.md); `path`: \{ `id`: `string`; \}; `query?`: `never`; `url`: `"/email/drafts/{id}/forwarded-attachments"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`AddForwardedAttachmentRequest`](AddForwardedAttachmentRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | The ID of the draft to add the forwarded attachment to. |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/email/drafts/{id}/forwarded-attachments"` | - |
