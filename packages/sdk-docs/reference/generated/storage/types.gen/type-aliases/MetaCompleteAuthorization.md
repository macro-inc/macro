# Type Alias: MetaCompleteAuthorization

> **MetaCompleteAuthorization** = \{ `browser_transaction?`: `string` \| `null`; `business_account_id?`: `null` \| [`MetaProviderId`](MetaProviderId.md); `code`: `string`; `phone_number_id?`: `null` \| [`MetaProviderId`](MetaProviderId.md); `state`: `string`; `whatsapp_mode?`: `null` \| [`WhatsappMode`](WhatsappMode.md); \}

Callback input. Tokens are always exchanged server-side.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-browser_transaction"></a> `browser_transaction?` | `string` \| `null` | Proof returned at initiation; mandatory for Instagram, absent for WhatsApp. |
| <a id="property-business_account_id"></a> `business_account_id?` | `null` \| [`MetaProviderId`](MetaProviderId.md) | - |
| <a id="property-code"></a> `code` | `string` | Single-use authorization code. |
| <a id="property-phone_number_id"></a> `phone_number_id?` | `null` \| [`MetaProviderId`](MetaProviderId.md) | - |
| <a id="property-state"></a> `state` | `string` | State returned by the server for this caller/team/provider. |
| <a id="property-whatsapp_mode"></a> `whatsapp_mode?` | `null` \| [`WhatsappMode`](WhatsappMode.md) | - |
