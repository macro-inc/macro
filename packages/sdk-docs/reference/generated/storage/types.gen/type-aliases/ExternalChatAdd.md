# Type Alias: ExternalChatAdd

> **ExternalChatAdd** = \{ `kind`: [`ExternalChatKind`](ExternalChatKind.md); `provider`: [`ExternalChatProvider`](ExternalChatProvider.md); `remoteId`: `string`; \}

Explicit request to add a chat; the provider account is selected
server-side. The chat's name always follows the provider.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-kind"></a> `kind` | [`ExternalChatKind`](ExternalChatKind.md) | Group or direct chat; must match what `remote_id` is. |
| <a id="property-provider"></a> `provider` | [`ExternalChatProvider`](ExternalChatProvider.md) | The service the chat lives in. |
| <a id="property-remoteid"></a> `remoteId` | `string` | The chat's id at the provider, as its chat list names it. WhatsApp: a group the requester's account has joined, or a direct chat's other person's JID. |
