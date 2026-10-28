# Type Alias: ListScheduledActionsData

> **ListScheduledActionsData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `include_events?`: `boolean` \| `null`; \}; `url`: `"/scheduled-actions"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `include_events?`: `boolean` \| `null`; \} | - |
| `query.include_events?` | `boolean` \| `null` | Backend clients must opt in to event actions; defaults to false (cron-only). |
| <a id="property-url"></a> `url` | `"/scheduled-actions"` | - |
