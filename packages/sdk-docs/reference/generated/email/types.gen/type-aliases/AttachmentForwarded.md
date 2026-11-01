# Type Alias: AttachmentForwarded

> **AttachmentForwarded** = \{ `attachment_id`: `string`; `draft_id`: `string`; `filename?`: `string` \| `null`; `message_provider_id`: `string`; `mime_type?`: `string` \| `null`; `provider_attachment_id?`: `string` \| `null`; `size_bytes?`: `number` \| `null`; \}

A forwarded attachment linking a draft to an original message's attachment.
Data is fetched from Gmail at send time rather than stored in S3.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachment_id"></a> `attachment_id` | `string` | The UUID of the original attachment in email_attachments. |
| <a id="property-draft_id"></a> `draft_id` | `string` | The ID of the draft message this forwarded attachment belongs to. |
| <a id="property-filename"></a> `filename?` | `string` \| `null` | Original file name of the attachment. |
| <a id="property-message_provider_id"></a> `message_provider_id` | `string` | The Gmail message ID of the original message containing the attachment. |
| <a id="property-mime_type"></a> `mime_type?` | `string` \| `null` | MIME type of the attachment. |
| <a id="property-provider_attachment_id"></a> `provider_attachment_id?` | `string` \| `null` | The Gmail attachment ID for fetching data from Gmail API. |
| <a id="property-size_bytes"></a> `size_bytes?` | `number` \| `null` | File size in bytes. |
