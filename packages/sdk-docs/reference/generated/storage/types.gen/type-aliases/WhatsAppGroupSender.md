# Type Alias: WhatsAppGroupSender

> **WhatsAppGroupSender** = \{ `name`: `string`; `person_id`: `string`; `user_id?`: `string` \| `null`; \}

Message sender from protocol-verified identity evidence.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | Display name, never authentication evidence. |
| <a id="property-person_id"></a> `person_id` | `string` | External person identity. |
| <a id="property-user_id"></a> `user_id?` | `string` \| `null` | Verified Macro user association, if present. |
