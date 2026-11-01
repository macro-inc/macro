# Type Alias: GtmInviteLink

> **GtmInviteLink** = \{ `convertedAt?`: `string` \| `null`; `createdAt`: `string`; `createdBy`: `string`; `expiresAt`: `string`; `firstName`: `string`; `firstOpenedAt?`: `string` \| `null`; `freeMonths`: `number`; `id`: `string`; `note?`: `string` \| `null`; `openCount`: `number`; `promoCode`: `string`; `recipientEmail?`: `string` \| `null`; `redeemedAt?`: `string` \| `null`; `redeemedBy?`: `string` \| `null`; `revokedAt?`: `string` \| `null`; `status`: [`GtmInviteLinkStatus`](GtmInviteLinkStatus.md); `stripeSubscriptionId?`: `string` \| `null`; `token`: `string`; \}

A link as shown on the staff dashboard.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-convertedat"></a> `convertedAt?` | `string` \| `null` | When the account started a paid subscription. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the link was created. |
| <a id="property-createdby"></a> `createdBy` | `string` | The Macro user id of the staff member who created the link. |
| <a id="property-expiresat"></a> `expiresAt` | `string` | When the link stops being openable. |
| <a id="property-firstname"></a> `firstName` | `string` | The recipient's first name. |
| <a id="property-firstopenedat"></a> `firstOpenedAt?` | `string` \| `null` | When the welcome page first loaded. |
| <a id="property-freemonths"></a> `freeMonths` | `number` | Free months the promotion grants. |
| <a id="property-id"></a> `id` | `string` | Primary key. |
| <a id="property-note"></a> `note?` | `string` \| `null` | Internal note. |
| <a id="property-opencount"></a> `openCount` | `number` | How many times the welcome page loaded. |
| <a id="property-promocode"></a> `promoCode` | `string` | The Stripe promotion code applied at checkout. |
| <a id="property-recipientemail"></a> `recipientEmail?` | `string` \| `null` | The recipient's email, when known. |
| <a id="property-redeemedat"></a> `redeemedAt?` | `string` \| `null` | When that account redeemed the link. |
| <a id="property-redeemedby"></a> `redeemedBy?` | `string` \| `null` | The Macro user id of the account that signed up through the link. |
| <a id="property-revokedat"></a> `revokedAt?` | `string` \| `null` | When staff revoked the link. |
| <a id="property-status"></a> `status` | [`GtmInviteLinkStatus`](GtmInviteLinkStatus.md) | Lifecycle status. |
| <a id="property-stripesubscriptionid"></a> `stripeSubscriptionId?` | `string` \| `null` | The Stripe subscription id of that subscription. |
| <a id="property-token"></a> `token` | `string` | The secret to embed in the link URL. |
