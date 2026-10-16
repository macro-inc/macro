# Type Alias: CrmCompanyFilters

> **CrmCompanyFilters** = \{ `company_ids?`: `string`[]; `hidden?`: `boolean` \| `null`; \}

The crm company filters used to narrow which CRM companies appear in soup.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-company_ids"></a> `company_ids?` | `string`[] | CRM company ids to filter by. Examples: ['11111111-...']. Empty to include all of the team's visible CRM companies. |
| <a id="property-hidden"></a> `hidden?` | `boolean` \| `null` | Optional `crm_companies.hidden` filter. `None` = visible only (default for back-compat with non-admin callers). `Some(false)` = visible only (explicit). `Some(true)` = hidden only — requires admin/owner team role; enforced by the CRM service from the caller's team receipt. |
