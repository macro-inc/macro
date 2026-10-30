# Type Alias: DisableSyncData

> **DisableSyncData** = \{ `body?`: `never`; `headers?`: \{ `X-Email-Link-Id?`: `string` \| `null`; \}; `path?`: `never`; `query?`: `never`; `url`: `"/email/sync"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-headers"></a> `headers?` | \{ `X-Email-Link-Id?`: `string` \| `null`; \} | - |
| `headers.X-Email-Link-Id?` | `string` \| `null` | Inbox link ID to act on instead of the caller's primary inbox; may name a delegated inbox. |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/email/sync"` | - |
