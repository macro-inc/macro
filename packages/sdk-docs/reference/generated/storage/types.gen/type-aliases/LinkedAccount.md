# Type Alias: LinkedAccount

> **LinkedAccount** = \{ `authorization_generation`: `number`; `id`: `string`; `identity_jid?`: `string` \| `null`; `state`: [`LinkedAccountState`](LinkedAccountState.md); `user_id`: `string`; \}

One person's account, never owned by a workspace.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-authorization_generation"></a> `authorization_generation` | `number` | Explicit consent generation; reconnecting a socket never changes it. |
| <a id="property-id"></a> `id` | `string` | Stable account identity. |
| <a id="property-identity_jid"></a> `identity_jid?` | `string` \| `null` | WhatsApp-verified identity, absent until the first pairing succeeds. |
| <a id="property-state"></a> `state` | [`LinkedAccountState`](LinkedAccountState.md) | Lifecycle. |
| <a id="property-user_id"></a> `user_id` | `string` | Authenticated owner. |
