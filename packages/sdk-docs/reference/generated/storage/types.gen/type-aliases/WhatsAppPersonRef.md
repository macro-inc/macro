# Type Alias: WhatsAppPersonRef

> **WhatsAppPersonRef** = \{ `name`: `string`; `user_id?`: `string` \| `null`; \}

A person named in a message: a Macro user when verified, else their
WhatsApp name, else their phone number.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | Display name, never authentication evidence. |
| <a id="property-user_id"></a> `user_id?` | `string` \| `null` | Verified Macro user, if any. |
