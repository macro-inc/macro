# Type Alias: MetaUploadedAttachment

> **MetaUploadedAttachment** = \{ `document_id`: `string`; `filename`: `string`; `kind`: [`MetaMediaKind`](MetaMediaKind.md); \}

A private file staged for an explicit customer reply; staging never sends it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-document_id"></a> `document_id` | `string` | Native Macro document, authorized again at send time. |
| <a id="property-filename"></a> `filename` | `string` | Original display filename. |
| <a id="property-kind"></a> `kind` | [`MetaMediaKind`](MetaMediaKind.md) | Verified attachment category. |
