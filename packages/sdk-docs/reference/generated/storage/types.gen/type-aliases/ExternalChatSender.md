# Type Alias: ExternalChatSender

> **ExternalChatSender** = \{ `name`: `string`; `personId`: `string`; `userId?`: `string` \| `null`; \}

Message sender from protocol-verified identity evidence.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | Display name, never authentication evidence. |
| <a id="property-personid"></a> `personId` | `string` | External person identity. |
| <a id="property-userid"></a> `userId?` | `string` \| `null` | Verified Macro user association, if present. |
