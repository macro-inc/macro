# Type Alias: InitOutlookLinkData

> **InitOutlookLinkData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `original_url?`: `string`; `reconnect_link_id?`: `string`; `scopes?`: `string`; \}; `url`: `"/link/outlook"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `original_url?`: `string`; `reconnect_link_id?`: `string`; `scopes?`: `string`; \} | - |
| `query.original_url?` | `string` | **OPTIONAL**. The original URL to redirect to. |
| `query.reconnect_link_id?` | `string` | Existing accessible inbox being reconnected or granted calendar consent. |
| `query.scopes?` | `string` | mail (default) or mail_and_calendar. Calendar requests obey the deployment calendar consent switch. |
| <a id="property-url"></a> `url` | `"/link/outlook"` | - |
