# Type Alias: MetaPublicConfiguration

> **MetaPublicConfiguration** = \{ `graph_version`: `string`; `instagram_app_id?`: `string` \| `null`; `instagram_human_agent_approved`: `boolean`; `instagram_redirect_uri?`: `string` \| `null`; `whatsapp_app_id?`: `string` \| `null`; `whatsapp_configuration_id?`: `string` \| `null`; `whatsapp_developer_available`: `boolean`; `whatsapp_platform_configuration_id?`: `string` \| `null`; \}

Public setup configuration, returned by the server rather than hardcoded in UI.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-graph_version"></a> `graph_version` | `string` | Explicitly supported Graph API version. |
| <a id="property-instagram_app_id"></a> `instagram_app_id?` | `string` \| `null` | Instagram app ID within the configured Meta business app. |
| <a id="property-instagram_human_agent_approved"></a> `instagram_human_agent_approved` | `boolean` | Operator-confirmed Meta HUMAN_AGENT approval for the configured Instagram app. |
| <a id="property-instagram_redirect_uri"></a> `instagram_redirect_uri?` | `string` \| `null` | Approved redirect URI for Instagram Login. |
| <a id="property-whatsapp_app_id"></a> `whatsapp_app_id?` | `string` \| `null` | Meta app ID used by WhatsApp Embedded Signup. |
| <a id="property-whatsapp_configuration_id"></a> `whatsapp_configuration_id?` | `string` \| `null` | Facebook Login for Business v4 configuration ID with coexistence enabled. |
| <a id="property-whatsapp_developer_available"></a> `whatsapp_developer_available` | `boolean` | A server-configured, recipient-restricted local WhatsApp test account exists. |
| <a id="property-whatsapp_platform_configuration_id"></a> `whatsapp_platform_configuration_id?` | `string` \| `null` | Optional dedicated v4 configuration for Platform signup. |
