# Type Alias: WhatsAppAccount

> **WhatsAppAccount** = \{ `authorizationGeneration`: `number`; `id`: `string`; `identityJid?`: `string` \| `null`; `state`: [`WhatsAppAccountState`](WhatsAppAccountState.md); `userId`: `string`; \}

One person's account, never owned by a workspace.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-authorizationgeneration"></a> `authorizationGeneration` | `number` | Explicit consent generation; reconnecting a socket never changes it. |
| <a id="property-id"></a> `id` | `string` | Stable account identity. |
| <a id="property-identityjid"></a> `identityJid?` | `string` \| `null` | WhatsApp-verified identity, absent until the first pairing succeeds. |
| <a id="property-state"></a> `state` | [`WhatsAppAccountState`](WhatsAppAccountState.md) | Lifecycle. |
| <a id="property-userid"></a> `userId` | `string` | Authenticated owner. |
