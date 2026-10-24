# Type Alias: DeliverScheduledActionWebhookData

> **DeliverScheduledActionWebhookData** = \{ `body`: \{\[`key`: `string`\]: `unknown`; \}; `path`: \{ `token`: `string`; \}; `query?`: `never`; `url`: `"/scheduled-actions/webhooks/{token}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | \{\[`key`: `string`\]: `unknown`; \} | Any JSON value, at most 64 KiB |
| <a id="property-path"></a> `path` | \{ `token`: `string`; \} | - |
| `path.token` | `string` | The routine's webhook token |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/scheduled-actions/webhooks/{token}"` | - |
