# Type Alias: SoupCrmCompanySoupPropertiesField

> **SoupCrmCompanySoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `createdAt`: `string`; `description?`: `string` \| `null`; `domains`: [`SoupCrmDomain`](SoupCrmDomain.md)[]; `emailSync`: `boolean`; `hidden`: `boolean`; `id`: `string`; `name?`: `string` \| `null`; `teamId`: `string`; `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; \}

A CRM company as displayed in Soup. Carries the core company
fields plus display metadata resolved from `crm_domain_directory`
against the primary (earliest-created) domain.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt` | `string` | When the company was created. |
| `description?` | `string` \| `null` | Display description from the primary domain's directory entry. |
| `domains` | [`SoupCrmDomain`](SoupCrmDomain.md)[] | Domains associated with this company, ordered by creation time ascending (primary first). |
| `emailSync` | `boolean` | Whether email sync is enabled for this company. |
| `hidden` | `boolean` | Whether the company is hidden from CRM listings. Soup filters these out by default. |
| `id` | `string` | The id of the company. |
| `name?` | `string` \| `null` | Display name from the primary domain's directory entry, or `None` when unresolved. |
| `teamId` | `string` | The id of the team that owns this company record. |
| `updatedAt` | `string` | When the company was last updated. |
| `viewedAt?` | `string` \| `null` | When the requesting user last viewed this company, or `None` if never viewed. Mirrors the `viewed_at` other soup entities carry. |
