# Type Alias: StartResponse

> **StartResponse** = \{ `attemptId`: `string`; `authorizationUrl`: `string`; `expiresIn`: `number`; \}

Public PKCE challenge and attempt handle; contains no verifier or provider tokens.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attemptid"></a> `attemptId` | `string` | Opaque owner-bound attempt handle. |
| <a id="property-authorizationurl"></a> `authorizationUrl` | `string` | Claude-hosted consent page. |
| <a id="property-expiresin"></a> `expiresIn` | `number` | Attempt lifetime in seconds. |
