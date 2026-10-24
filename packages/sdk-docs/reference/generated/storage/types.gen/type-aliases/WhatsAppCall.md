# Type Alias: WhatsAppCall

> **WhatsAppCall** = \{ `duration_seconds?`: `number` \| `null`; `outcome`: [`WhatsAppCallOutcome`](WhatsAppCallOutcome.md); `video`: `boolean`; \}

A call in the group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-duration_seconds"></a> `duration_seconds?` | `number` \| `null` | Length, when it connected. |
| <a id="property-outcome"></a> `outcome` | [`WhatsAppCallOutcome`](WhatsAppCallOutcome.md) | How it went for the account that saw it. |
| <a id="property-video"></a> `video` | `boolean` | Video rather than voice. |
