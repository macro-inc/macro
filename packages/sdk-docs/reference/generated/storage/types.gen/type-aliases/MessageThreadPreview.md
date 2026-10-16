# Type Alias: MessageThreadPreview

> **MessageThreadPreview** = \{ `latest_reply_at?`: `string` \| `null`; `preview`: [`Message`](Message.md)[]; `reply_count`: `number`; \}

Thread counts and its oldest three live replies.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-latest_reply_at"></a> `latest_reply_at?` | `string` \| `null` | Creation time of the latest live reply. |
| <a id="property-preview"></a> `preview` | [`Message`](Message.md)[] | Bounded preview using the canonical message shape. |
| <a id="property-reply_count"></a> `reply_count` | `number` | Total live reply count. |
