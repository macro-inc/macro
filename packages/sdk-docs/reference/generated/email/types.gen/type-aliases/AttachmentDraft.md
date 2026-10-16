# Type Alias: AttachmentDraft

> **AttachmentDraft** = \{ `content_type`: `string`; `draft_id`: `string`; `file_name`: `string`; `id`: `string`; `s3_key`: `string`; `sha`: `string`; `size`: `number`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content_type"></a> `content_type` | `string` | MIME type of the attachment (e.g., "application/pdf", "image/png"). |
| <a id="property-draft_id"></a> `draft_id` | `string` | The ID of the draft message this attachment belongs to. |
| <a id="property-file_name"></a> `file_name` | `string` | Original file name of the attachment. |
| <a id="property-id"></a> `id` | `string` | Unique identifier for the attachment. |
| <a id="property-s3_key"></a> `s3_key` | `string` | S3 object key where the attachment content is stored. |
| <a id="property-sha"></a> `sha` | `string` | SHA-256 hash of the file content for integrity verification. |
| <a id="property-size"></a> `size` | `number` | File size in bytes. |
