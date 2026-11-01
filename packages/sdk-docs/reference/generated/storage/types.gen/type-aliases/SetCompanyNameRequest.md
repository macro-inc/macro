# Type Alias: SetCompanyNameRequest

> **SetCompanyNameRequest** = \{ `name`: `string`; \}

Request body for `PUT /companies/{company_id}/name`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | New display name for the company. Stored on the team-scoped `crm_companies.custom_name` override, which read paths COALESCE over the global directory name — the shared directory is never modified. Must be non-blank (400 otherwise). |
