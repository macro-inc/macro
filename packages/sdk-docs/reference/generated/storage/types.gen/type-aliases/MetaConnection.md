# Type Alias: MetaConnection

> **MetaConnection** = \{ `account_id`: [`MetaProviderId`](MetaProviderId.md); `business_account_id?`: `null` \| [`MetaProviderId`](MetaProviderId.md); `connected_at?`: `string` \| `null`; `credential_expires_at?`: `string` \| `null`; `developer_account`: `boolean`; `display_name`: `string`; `health_error?`: `string` \| `null`; `human_agent_approved`: `boolean`; `id`: `string`; `provider`: [`MetaProvider`](MetaProvider.md); `registration_attempted_at?`: `string` \| `null`; `registration_status?`: `null` \| [`RegistrationStatus`](RegistrationStatus.md); `status`: [`MetaConnectionStatus`](MetaConnectionStatus.md); `team_id`: `string`; `user_id`: `string`; `whatsapp_mode?`: `null` \| [`WhatsappMode`](WhatsappMode.md); \}

Public account health; never includes credentials.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account_id"></a> `account_id` | [`MetaProviderId`](MetaProviderId.md) | Connected phone-number ID or Instagram professional ID. |
| <a id="property-business_account_id"></a> `business_account_id?` | `null` \| [`MetaProviderId`](MetaProviderId.md) | - |
| <a id="property-connected_at"></a> `connected_at?` | `string` \| `null` | Last successful connection time, not the start of imported history. |
| <a id="property-credential_expires_at"></a> `credential_expires_at?` | `string` \| `null` | Expiry returned by the provider; absence does not mean irrevocable access. |
| <a id="property-developer_account"></a> `developer_account` | `boolean` | Development test number; never evidence of coexistence. |
| <a id="property-display_name"></a> `display_name` | `string` | Display label returned by the provider. |
| <a id="property-health_error"></a> `health_error?` | `string` \| `null` | Sanitized operational error code. |
| <a id="property-human_agent_approved"></a> `human_agent_approved` | `boolean` | Verified HUMAN_AGENT approval; false by default. |
| <a id="property-id"></a> `id` | `string` | Macro connection identity, preserved through reconnect. |
| <a id="property-provider"></a> `provider` | [`MetaProvider`](MetaProvider.md) | Official API used by this connection. |
| <a id="property-registration_attempted_at"></a> `registration_attempted_at?` | `string` \| `null` | Time of the latest uncertain or rate-limited registration attempt; never a PIN. |
| <a id="property-registration_status"></a> `registration_status?` | `null` \| [`RegistrationStatus`](RegistrationStatus.md) | - |
| <a id="property-status"></a> `status` | [`MetaConnectionStatus`](MetaConnectionStatus.md) | Current local connection health. |
| <a id="property-team_id"></a> `team_id` | `string` | Owning Macro team. |
| <a id="property-user_id"></a> `user_id` | `string` | Current connector. Reconnect changes this user without transferring existing channel/file grants. |
| <a id="property-whatsapp_mode"></a> `whatsapp_mode?` | `null` \| [`WhatsappMode`](WhatsappMode.md) | - |
