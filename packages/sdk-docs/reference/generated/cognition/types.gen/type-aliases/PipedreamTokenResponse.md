# Type Alias: PipedreamTokenResponse

> **PipedreamTokenResponse** = \{ `connect_link_url?`: `string` \| `null`; `connect_url?`: `string` \| `null`; `expires_at?`: `string` \| `null`; `provider`: [`PipedreamProviderResponse`](PipedreamProviderResponse.md); `token?`: `string` \| `null`; \}

Response from starting a connect flow: a Pipedream Connect token, or for
`provider = connect` a Macro Connect URL.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-connect_link_url"></a> `connect_link_url?` | `string` \| `null` | Shareable link that opens the same connect flow in a browser tab. Pipedream only. |
| <a id="property-connect_url"></a> `connect_url?` | `string` \| `null` | URL to open in a popup or browser tab for Macro Connect's consent flow; once it finishes, call `/pipedream/mcp/connect/complete`. Connect only. |
| <a id="property-expires_at"></a> `expires_at?` | `string` \| `null` | RFC 3339 expiry of the token. Pipedream only. |
| <a id="property-provider"></a> `provider` | [`PipedreamProviderResponse`](PipedreamProviderResponse.md) | The backend this flow connects through. |
| <a id="property-token"></a> `token?` | `string` \| `null` | Short-lived token to open the Pipedream Connect UI with. Pipedream only. |
