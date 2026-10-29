# Type Alias: ExternalChatSystemLine

> **ExternalChatSystemLine** = \{ `action`: [`ExternalChatSystemAction`](ExternalChatSystemAction.md); `actor?`: `null` \| [`ExternalChatPersonRef`](ExternalChatPersonRef.md); `call?`: `null` \| [`ExternalChatCall`](ExternalChatCall.md); `participants`: [`ExternalChatPersonRef`](ExternalChatPersonRef.md)[]; `value?`: `string` \| `null`; \}

Something that happened in the chat.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action"></a> `action` | [`ExternalChatSystemAction`](ExternalChatSystemAction.md) | What happened. |
| <a id="property-actor"></a> `actor?` | `null` \| [`ExternalChatPersonRef`](ExternalChatPersonRef.md) | - |
| <a id="property-call"></a> `call?` | `null` \| [`ExternalChatCall`](ExternalChatCall.md) | - |
| <a id="property-participants"></a> `participants` | [`ExternalChatPersonRef`](ExternalChatPersonRef.md)[] | Who it happened to (added, removed, promoted, …). |
| <a id="property-value"></a> `value?` | `string` \| `null` | New subject or description; disappearing-messages timer in seconds (`"0"` is off). |
