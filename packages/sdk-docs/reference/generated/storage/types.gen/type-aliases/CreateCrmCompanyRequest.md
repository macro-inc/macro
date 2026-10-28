# Type Alias: CreateCrmCompanyRequest

> **CreateCrmCompanyRequest** = \{ `domain`: `string`; `name`: `string`; \}

Request body for `POST /crm/companies`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-domain"></a> `domain` | `string` | The company's email domain, e.g. "acme.com". Must be a bare domain (no scheme, path, or email) and not a generic email provider domain. |
| <a id="property-name"></a> `name` | `string` | Display name for the company. Team-scoped: overrides the domain-directory name on every read path. |
