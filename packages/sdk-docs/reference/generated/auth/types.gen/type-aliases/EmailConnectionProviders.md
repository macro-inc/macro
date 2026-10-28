# Type Alias: EmailConnectionProviders

> **EmailConnectionProviders** = \{ `gmail`: `boolean`; `outlook`: `boolean`; `outlook_admin_consent_url?`: `string` \| `null`; \}

Actual deployment availability for the provider selector.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-gmail"></a> `gmail` | `boolean` | - |
| <a id="property-outlook"></a> `outlook` | `boolean` | - |
| <a id="property-outlook_admin_consent_url"></a> `outlook_admin_consent_url?` | `string` \| `null` | Where a Microsoft 365 administrator approves Macro for their whole directory. Present when Outlook is configured and the request named an `original_url` for the administrator's browser to return to. |
