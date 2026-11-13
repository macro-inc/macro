# Type Alias: CredentialRejectedResponse

> **CredentialRejectedResponse** = \{ `code`: `string`; `message`: `string`; \}

Error body for a provider that refused the caller's connected credential.

JSON rather than the plain text other failures answer with, so a client
can tell this 409 from a disconnected runtime and show `message` as is.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `string` | Always [`Self::CODE`]. |
| <a id="property-message"></a> `message` | `string` | What to tell the caller, e.g. which kind of key to reconnect with. |
