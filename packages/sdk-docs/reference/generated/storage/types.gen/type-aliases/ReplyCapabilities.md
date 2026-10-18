# Type Alias: ReplyCapabilities

> **ReplyCapabilities** = \{ `max_attachments`: `number`; `media`: [`MetaMediaCapability`](MetaMediaCapability.md)[]; `modes`: [`ReplyMode`](ReplyMode.md)[]; `text_limit`: `number`; `text_limit_in_bytes`: `boolean`; \}

Operations implemented by this integration, independently of current permission.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-max_attachments"></a> `max_attachments` | `number` | Maximum files in one implemented send operation. |
| <a id="property-media"></a> `media` | [`MetaMediaCapability`](MetaMediaCapability.md)[] | Supported private attachment categories and effective limits. |
| <a id="property-modes"></a> `modes` | [`ReplyMode`](ReplyMode.md)[] | Supported explicit sending modes. |
| <a id="property-text_limit"></a> `text_limit` | `number` | Maximum text units. |
| <a id="property-text_limit_in_bytes"></a> `text_limit_in_bytes` | `boolean` | Whether text is counted in UTF-8 bytes instead of Unicode characters. |
