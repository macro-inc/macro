# Type Alias: PasswordlessRequest

> **PasswordlessRequest** = \{ `email`: `string`; `is_agent?`: `boolean`; `redirect_uri`: `string`; `referral_code?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email` | `string` | The email to initiate passwordless authentication for |
| <a id="property-is_agent"></a> `is_agent?` | `boolean` | Create an agent account if this address has no account yet. Ignored for an existing account, whose type never changes. |
| <a id="property-redirect_uri"></a> `redirect_uri` | `string` | The redirect uri to redirect to after login |
| <a id="property-referral_code"></a> `referral_code?` | `string` \| `null` | The referral code |
