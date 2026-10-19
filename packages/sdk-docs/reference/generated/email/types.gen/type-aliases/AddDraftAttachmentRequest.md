# Type Alias: AddDraftAttachmentRequest

> **AddDraftAttachmentRequest** = \{ `file_name`: `string`; `sha`: `string`; `size`: `number`; `upload_id?`: `string` \| `null`; \}

The request passed to send a message

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-file_name"></a> `file_name` | `string` | The name of the file being uploaded. |
| <a id="property-sha"></a> `sha` | `string` | The SHA256 hash of the file being uploaded. |
| <a id="property-size"></a> `size` | `number` | The size of the file in bytes. |
| <a id="property-upload_id"></a> `upload_id?` | `string` \| `null` | Stable client upload identifier. Retry the same file with the same ID. |
