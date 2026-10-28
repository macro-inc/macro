# Type Alias: CodexConnectionStatus

> **CodexConnectionStatus** = \{ `accountId?`: `string` \| `null`; `connected`: `boolean`; `email?`: `string` \| `null`; `environmentId?`: `string` \| `null`; \}

Safe connection metadata; no secret or masked token is returned.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accountid"></a> `accountId?` | `string` \| `null` | Connected provider account identifier. |
| <a id="property-connected"></a> `connected` | `boolean` | Whether the user has completed provider authorization. |
| <a id="property-email"></a> `email?` | `string` \| `null` | Reserved until provider-verified email metadata is available. |
| <a id="property-environmentid"></a> `environmentId?` | `string` \| `null` | Explicitly selected remote environment. |
