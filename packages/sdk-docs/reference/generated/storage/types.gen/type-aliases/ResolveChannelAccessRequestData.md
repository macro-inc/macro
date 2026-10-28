# Type Alias: ResolveChannelAccessRequestData

> **ResolveChannelAccessRequestData** = \{ `body`: [`ResolveChannelAccessRequest`](ResolveChannelAccessRequest.md); `path`: \{ `channel_id`: `string`; `request_id`: `string`; \}; `query?`: `never`; `url`: `"/channels/{channel_id}/access-requests/{request_id}/resolve"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`ResolveChannelAccessRequest`](ResolveChannelAccessRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `channel_id`: `string`; `request_id`: `string`; \} | - |
| `path.channel_id` | `string` | Channel ID |
| `path.request_id` | `string` | Access request ID |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/channels/{channel_id}/access-requests/{request_id}/resolve"` | - |
