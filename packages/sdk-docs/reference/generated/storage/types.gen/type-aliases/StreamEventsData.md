# Type Alias: StreamEventsData

> **StreamEventsData** = \{ `body?`: `never`; `path?`: `never`; `query`: \{ `filters?`: `string`; `scope`: [`WebhookScope`](WebhookScope.md); \}; `url`: `"/webhook/events/stream"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query` | \{ `filters?`: `string`; `scope`: [`WebhookScope`](WebhookScope.md); \} | - |
| `query.filters?` | `string` | URL-encoded JSON array of webhook filters, identical to the persisted webhook `filters` field. |
| `query.scope` | [`WebhookScope`](WebhookScope.md) | Personal or team workspace whose webhook lifecycle events are delivered. |
| <a id="property-url"></a> `url` | `"/webhook/events/stream"` | - |
