# Type Alias: UpsertScheduledMessageData

> **UpsertScheduledMessageData** = \{ `body`: [`UpsertScheduledRequest`](UpsertScheduledRequest.md); `path`: \{ `id`: `string`; \}; `query?`: `never`; `url`: `"/email/drafts/scheduled/{id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`UpsertScheduledRequest`](UpsertScheduledRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | The ID of the draft message to schedule |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/email/drafts/scheduled/{id}"` | - |
