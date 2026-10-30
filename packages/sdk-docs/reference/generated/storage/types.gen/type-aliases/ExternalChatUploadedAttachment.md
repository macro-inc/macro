# Type Alias: ExternalChatUploadedAttachment

> **ExternalChatUploadedAttachment** = \{ `filename`: `string`; `kind`: [`ExternalChatMediaKind`](ExternalChatMediaKind.md); `uploadId`: `string`; \}

A staged attachment, sent only by a later deliberate send.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-filename"></a> `filename` | `string` | Display filename. |
| <a id="property-kind"></a> `kind` | [`ExternalChatMediaKind`](ExternalChatMediaKind.md) | Category. |
| <a id="property-uploadid"></a> `uploadId` | `string` | Use as `upload_id` in a media send. |
