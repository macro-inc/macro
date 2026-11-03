# Type Alias: CreateCrmCompanyRequest

> **CreateCrmCompanyRequest** = \{ `domain?`: `string` \| `null`; `name`: `string`; \}

Request body for `POST /crm/companies`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-domain"></a> `domain?` | `string` \| `null` | Optional company domain, e.g. "acme.com". Omit for a name-only company. When supplied, must be a bare domain (no scheme, path, or email) and not a generic email provider domain. |
| <a id="property-name"></a> `name` | `string` | Display name for the company. Team-scoped: overrides the domain-directory name on every read path. |
