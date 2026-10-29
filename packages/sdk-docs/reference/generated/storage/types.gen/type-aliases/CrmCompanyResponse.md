# Type Alias: CrmCompanyResponse

> **CrmCompanyResponse** = \{ `contacts`: [`CrmContactResponse`](CrmContactResponse.md)[]; `createdAt`: `string`; `description?`: `string` \| `null`; `domains`: [`CrmDomainResponse`](CrmDomainResponse.md)[]; `emailSync`: `boolean`; `hidden`: `boolean`; `id`: `string`; `name?`: `string` \| `null`; `teamId`: `string`; `updatedAt`: `string`; \}

A CRM company as returned by `GET /crm/companies/{company_id}`.
Mirrors the soup-listed `crmCompany` shape (`name` / `description`
resolved from the primary domain's `crm_domain_directory` entry) and
embeds the company's contacts so the panel can render in a single
request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-contacts"></a> `contacts` | [`CrmContactResponse`](CrmContactResponse.md)[] | Contacts attached to this company. Hidden contacts are filtered out for non-admin viewers. |
| <a id="property-createdat"></a> `createdAt` | `string` | Earliest known interaction with this company. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Display description from the primary domain's directory entry. |
| <a id="property-domains"></a> `domains` | [`CrmDomainResponse`](CrmDomainResponse.md)[] | All domains associated with this company, ordered by creation time ascending (primary first). |
| <a id="property-emailsync"></a> `emailSync` | `boolean` | Whether email sync is enabled for this company. |
| <a id="property-hidden"></a> `hidden` | `boolean` | Whether the company is hidden from CRM listings for the requesting team. Non-admin viewers never see `hidden = true` rows (the endpoint 404s for them); admin/owner callers see hidden companies so they can render the right toggle state. |
| <a id="property-id"></a> `id` | `string` | The id of the company. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name from the primary domain's directory entry, or `None` when unresolved. |
| <a id="property-teamid"></a> `teamId` | `string` | The id of the team that owns this company record. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Most recent known interaction with this company. |
