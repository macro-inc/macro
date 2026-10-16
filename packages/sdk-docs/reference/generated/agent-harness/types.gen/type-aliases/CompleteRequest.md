# Type Alias: CompleteRequest

> **CompleteRequest** = \{ `attemptId`: `string`; `code`: `string`; \}

One-time manual code. Deliberately does not implement Debug.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attemptid"></a> `attemptId` | `string` | Server-issued handle; never an owner selected by the caller. |
| <a id="property-code"></a> `code` | `string` | Claude's complete code#state string, not an access token. |
