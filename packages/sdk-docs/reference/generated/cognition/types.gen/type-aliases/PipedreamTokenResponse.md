# Type Alias: PipedreamTokenResponse

> **PipedreamTokenResponse** = \{ `connect_link_url`: `string`; `expires_at`: `string`; `token`: `string`; \}

Response from creating a Pipedream Connect token.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-connect_link_url"></a> `connect_link_url` | `string` | Shareable link that opens the same connect flow in a browser tab. |
| <a id="property-expires_at"></a> `expires_at` | `string` | RFC 3339 expiry of the token. |
| <a id="property-token"></a> `token` | `string` | Short-lived token to open the Pipedream Connect UI with. |
