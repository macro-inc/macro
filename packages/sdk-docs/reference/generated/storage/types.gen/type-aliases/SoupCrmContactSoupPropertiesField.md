# Type Alias: SoupCrmContactSoupPropertiesField

> **SoupCrmContactSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `companyId?`: `string` \| `null`; `companyName?`: `string` \| `null`; `createdAt`: `string`; `email?`: `string` \| `null`; `firstInteraction`: `string`; `hidden`: `boolean`; `id`: `string`; `lastInteraction`: `string`; `name?`: `string` \| `null`; `teamId`: `string`; `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; \}

One original CRM contact record, selected from the viewer's accessible teams.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `companyId?` | `string` \| `null` | Parent company ID; `None` for a contact without a company. |
| `companyName?` | `string` \| `null` | Parent company's display name; `None` without a company. |
| `createdAt` | `string` | Record creation time. |
| `email?` | `string` \| `null` | Full email address; `None` for a contact added by name alone. |
| `firstInteraction` | `string` | Earliest interaction for this team record. |
| `hidden` | `boolean` | Whether the contact or parent company is hidden. |
| `id` | `string` | Original team-owned contact ID. |
| `lastInteraction` | `string` | Latest interaction for this team record. |
| `name?` | `string` \| `null` | Team-local display name, if known. |
| `teamId` | `string` | Team owning this record. |
| `updatedAt` | `string` | Record update time. |
| `viewedAt?` | `string` \| `null` | The viewer's latest visit to this record. |
