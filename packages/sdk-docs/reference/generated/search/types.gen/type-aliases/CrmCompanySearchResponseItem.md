# Type Alias: CrmCompanySearchResponseItem

> **CrmCompanySearchResponseItem** = \{ `createdAt`: `string`; `description?`: `string` \| `null`; `domains`: [`CrmCompanySearchDomain`](CrmCompanySearchDomain.md)[]; `hidden`: `boolean`; `id`: `string`; `name?`: `string` \| `null`; `nameHighlighted?`: `string` \| `null`; `teamId`: `string`; `updatedAt`: `string`; \}

A CRM company match in unified search results. Carries the display
metadata resolved from the primary domain plus the highlighted name.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When the company was created. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Display description from the primary domain's directory entry. |
| <a id="property-domains"></a> `domains` | [`CrmCompanySearchDomain`](CrmCompanySearchDomain.md)[] | Domains associated with this company, primary first. |
| <a id="property-hidden"></a> `hidden` | `boolean` | Whether the company is hidden from CRM listings. |
| <a id="property-id"></a> `id` | `string` | The id of the company. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name from the primary domain's directory entry. |
| <a id="property-namehighlighted"></a> `nameHighlighted?` | `string` \| `null` | `name` with matched spans wrapped in `<macro_em>…</macro_em>`. |
| <a id="property-teamid"></a> `teamId` | `string` | The id of the team that owns this company record. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When the company was last updated (the sort key). |
