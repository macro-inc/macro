# Type Alias: PersonProfile

> **PersonProfile** = \{ `email_address`: `string`; `headline?`: `string` \| `null`; `linkedin_url?`: `string` \| `null`; `organization_name?`: `string` \| `null`; `photo_url?`: `string` \| `null`; `title?`: `string` \| `null`; \}

One person's public profile, keyed by their lowercased email address.
Every detail is `None` for an address the provider could not match.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email_address"></a> `email_address` | `string` | Lowercased email address. |
| <a id="property-headline"></a> `headline?` | `string` \| `null` | LinkedIn headline. |
| <a id="property-linkedin_url"></a> `linkedin_url?` | `string` \| `null` | LinkedIn profile URL (`https://www.linkedin.com/in/…`). |
| <a id="property-organization_name"></a> `organization_name?` | `string` \| `null` | Current employer. |
| <a id="property-photo_url"></a> `photo_url?` | `string` \| `null` | Profile photo URL. |
| <a id="property-title"></a> `title?` | `string` \| `null` | Current job title. |
