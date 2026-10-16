# Type Alias: DeliverDatabaseWebhookData

> **DeliverDatabaseWebhookData** = \{ `body`: `unknown`; `path`: \{ `token`: `string`; \}; `query?`: `never`; `url`: `"/databases/webhooks/{token}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | `unknown` | A row, or an array of rows |
| <a id="property-path"></a> `path` | \{ `token`: `string`; \} | - |
| `path.token` | `string` | The webhook's secret token |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/databases/webhooks/{token}"` | - |
