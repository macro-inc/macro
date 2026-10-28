# Type Alias: SoupThreadInfo

> **SoupThreadInfo** = \{ `latest_reply_at?`: `string` \| `null`; `preview`: [`SoupThreadReply`](SoupThreadReply.md)[]; `reply_count`: `number`; \}

Thread metadata and preview replies for soup channel messages.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-latest_reply_at"></a> `latest_reply_at?` | `string` \| `null` | Timestamp of the latest reply. |
| <a id="property-preview"></a> `preview` | [`SoupThreadReply`](SoupThreadReply.md)[] | Preview replies. |
| <a id="property-reply_count"></a> `reply_count` | `number` | Total reply count. |
