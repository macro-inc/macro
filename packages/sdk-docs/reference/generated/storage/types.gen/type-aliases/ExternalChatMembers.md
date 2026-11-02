# Type Alias: ExternalChatMembers

> **ExternalChatMembers** = \{ `announce`: `boolean`; `name`: `string`; `observedAt`: `string`; `participants`: [`ExternalChatParticipant`](ExternalChatParticipant.md)[]; \}

A chat's members as the caller's account last read them.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-announce"></a> `announce` | `boolean` | Only admins may post. |
| <a id="property-name"></a> `name` | `string` | The chat's name at the provider. |
| <a id="property-observedat"></a> `observedAt` | `string` | When this was read from WhatsApp. |
| <a id="property-participants"></a> `participants` | [`ExternalChatParticipant`](ExternalChatParticipant.md)[] | Everyone in the chat. |
