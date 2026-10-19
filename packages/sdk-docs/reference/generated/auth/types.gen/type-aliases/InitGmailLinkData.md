# Type Alias: InitGmailLinkData

> **InitGmailLinkData** = \{ `body?`: `never`; `path?`: `never`; `query`: \{ `original_url`: `string`; `reconnect_link_id?`: `string`; `scopes?`: `string`; \}; `url`: `"/link/gmail"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query` | \{ `original_url`: `string`; `reconnect_link_id?`: `string`; `scopes?`: `string`; \} | - |
| `query.original_url` | `string` | **OPTIONAL**. The original url to redirect to. |
| `query.reconnect_link_id?` | `string` | Existing accessible Gmail inbox being reconnected; does not consume an additional inbox slot. |
| `query.scopes?` | `string` | **OPTIONAL**. Which capabilities to request consent for: `gmail` (default), `gmail_and_calendar`, or `calendar`. The calendar variants are only honored when the deployment allows calendar scope requests. |
| <a id="property-url"></a> `url` | `"/link/gmail"` | - |
