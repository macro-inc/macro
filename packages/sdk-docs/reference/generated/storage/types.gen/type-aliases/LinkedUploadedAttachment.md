# Type Alias: LinkedUploadedAttachment

> **LinkedUploadedAttachment** = \{ `filename`: `string`; `kind`: [`LinkedMediaKind`](LinkedMediaKind.md); `upload_id`: `string`; \}

A staged attachment, sent only by a later deliberate send.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-filename"></a> `filename` | `string` | Display filename. |
| <a id="property-kind"></a> `kind` | [`LinkedMediaKind`](LinkedMediaKind.md) | Category. |
| <a id="property-upload_id"></a> `upload_id` | `string` | Use as `upload_id` in a media send; also the future document id. |
