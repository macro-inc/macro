# Type Alias: MetaMediaCapability

> **MetaMediaCapability** = \{ `caption_limit?`: `number` \| `null`; `kind`: [`MetaMediaKind`](MetaMediaKind.md); `max_bytes`: `number`; `mime_types`: `string`[]; \}

One currently supported provider attachment category.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-caption_limit"></a> `caption_limit?` | `number` \| `null` | Maximum caption characters, absent when text must be sent separately. |
| <a id="property-kind"></a> `kind` | [`MetaMediaKind`](MetaMediaKind.md) | Native attachment category. |
| <a id="property-max_bytes"></a> `max_bytes` | `number` | Effective provider and Macro byte limit. |
| <a id="property-mime_types"></a> `mime_types` | `string`[] | Allowed MIME types for the selected account. |
