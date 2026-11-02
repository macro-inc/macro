# Type Alias: WhatsAppLookup

> **WhatsAppLookup** = \{ `chatJid?`: `string` \| `null`; `id`: `string`; `phoneNumber`: `string`; `state`: [`WhatsAppLookupState`](WhatsAppLookupState.md); \}

The owner asking whether a phone number has a WhatsApp account, to start
a direct chat with it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chatjid"></a> `chatJid?` | `string` \| `null` | Found: the direct chat's JID, now addable from the chat list. |
| <a id="property-id"></a> `id` | `string` | Poll `GET /whatsapp/lookups/{id}` with it. |
| <a id="property-phonenumber"></a> `phoneNumber` | `string` | The number asked about, E.164 (`+<digits>`). |
| <a id="property-state"></a> `state` | [`WhatsAppLookupState`](WhatsAppLookupState.md) | Progress. |
