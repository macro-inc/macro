# Type Alias: MetaConversation

> **MetaConversation** = \{ `channel_id`: `string`; `connection_id`: `string`; `customer_display_name?`: `string` \| `null`; `customer_handle?`: `string` \| `null`; `customer_id`: [`MetaProviderId`](MetaProviderId.md); `customer_phone?`: `string` \| `null`; `group_status?`: `null` \| [`MetaGroupStatus`](MetaGroupStatus.md); `kind?`: [`MetaConversationKind`](MetaConversationKind.md); `last_customer_message_at?`: `string` \| `null`; \}

Native conversation metadata, available only after ordinary channel access.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Real Macro channel identity. |
| <a id="property-connection_id"></a> `connection_id` | `string` | Owning account's connection. |
| <a id="property-customer_display_name"></a> `customer_display_name?` | `string` \| `null` | Account-scoped display label; never a Macro or CRM identity. |
| <a id="property-customer_handle"></a> `customer_handle?` | `string` \| `null` | Mutable handle for display only. |
| <a id="property-customer_id"></a> `customer_id` | [`MetaProviderId`](MetaProviderId.md) | Recipient's account-scoped identity. |
| <a id="property-customer_phone"></a> `customer_phone?` | `string` \| `null` | Verified phone, when present. |
| <a id="property-group_status"></a> `group_status?` | `null` \| [`MetaGroupStatus`](MetaGroupStatus.md) | - |
| <a id="property-kind"></a> `kind?` | [`MetaConversationKind`](MetaConversationKind.md) | Destination kind; group identifiers never enter person alias resolution. |
| <a id="property-last_customer_message_at"></a> `last_customer_message_at?` | `string` \| `null` | Latest eligible inbound source timestamp. |
