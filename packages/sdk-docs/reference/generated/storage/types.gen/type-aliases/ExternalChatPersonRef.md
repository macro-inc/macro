# Type Alias: ExternalChatPersonRef

> **ExternalChatPersonRef** = \{ `name`: `string`; `userId?`: `string` \| `null`; \}

A person named in a message: a Macro user when verified, else their name
at the provider, else their phone number.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | Display name, never authentication evidence. |
| <a id="property-userid"></a> `userId?` | `string` \| `null` | Verified Macro user, if any. |
