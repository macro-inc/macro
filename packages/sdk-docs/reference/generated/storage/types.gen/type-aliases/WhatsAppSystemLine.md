# Type Alias: WhatsAppSystemLine

> **WhatsAppSystemLine** = \{ `action`: [`WhatsAppSystemAction`](WhatsAppSystemAction.md); `actor?`: `null` \| [`WhatsAppPersonRef`](WhatsAppPersonRef.md); `call?`: `null` \| [`WhatsAppCall`](WhatsAppCall.md); `participants`: [`WhatsAppPersonRef`](WhatsAppPersonRef.md)[]; `value?`: `string` \| `null`; \}

Something that happened in the group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action"></a> `action` | [`WhatsAppSystemAction`](WhatsAppSystemAction.md) | What happened. |
| <a id="property-actor"></a> `actor?` | `null` \| [`WhatsAppPersonRef`](WhatsAppPersonRef.md) | - |
| <a id="property-call"></a> `call?` | `null` \| [`WhatsAppCall`](WhatsAppCall.md) | - |
| <a id="property-participants"></a> `participants` | [`WhatsAppPersonRef`](WhatsAppPersonRef.md)[] | Who it happened to (added, removed, promoted, …). |
| <a id="property-value"></a> `value?` | `string` \| `null` | New subject or description; disappearing-messages timer in seconds (`"0"` is off). |
