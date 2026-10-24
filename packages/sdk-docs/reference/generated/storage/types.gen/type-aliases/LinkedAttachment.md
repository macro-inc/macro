# Type Alias: LinkedAttachment

> **LinkedAttachment** = \{ `document_id?`: `string` \| `null`; `file_name`: `string`; `mime`: `string`; `ordinal`: `number`; `size`: `number`; `state`: [`LinkedAttachmentState`](LinkedAttachmentState.md); \}

One attachment of a linked message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-document_id"></a> `document_id?` | `string` \| `null` | The private document, once ready. |
| <a id="property-file_name"></a> `file_name` | `string` | Display filename. |
| <a id="property-mime"></a> `mime` | `string` | Declared MIME type. |
| <a id="property-ordinal"></a> `ordinal` | `number` | Position within the message. |
| <a id="property-size"></a> `size` | `number` | Declared size in bytes. |
| <a id="property-state"></a> `state` | [`LinkedAttachmentState`](LinkedAttachmentState.md) | Current state. |
