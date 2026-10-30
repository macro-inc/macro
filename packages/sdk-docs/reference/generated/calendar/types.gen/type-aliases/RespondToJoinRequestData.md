# Type Alias: RespondToJoinRequestData

> **RespondToJoinRequestData** = \{ `body`: [`RespondToJoinRequestRequest`](RespondToJoinRequestRequest.md); `path`: \{ `request_id`: `string`; \}; `query?`: `never`; `url`: `"/join-requests/{request_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`RespondToJoinRequestRequest`](RespondToJoinRequestRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `request_id`: `string`; \} | - |
| `path.request_id` | `string` | Join request id |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/join-requests/{request_id}"` | - |
