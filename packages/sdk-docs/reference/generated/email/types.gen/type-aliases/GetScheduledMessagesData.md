# Type Alias: GetScheduledMessagesData

> **GetScheduledMessagesData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `limit?`: `number`; `offset?`: `number`; \}; `url`: `"/email/drafts/scheduled"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `limit?`: `number`; `offset?`: `number`; \} | - |
| `query.limit?` | `number` | The maximum number of scheduled messages to return. |
| `query.offset?` | `number` | The number of scheduled messages to skip. |
| <a id="property-url"></a> `url` | `"/email/drafts/scheduled"` | - |
