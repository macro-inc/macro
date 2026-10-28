# Type Alias: SoupDatabaseRowSoupPropertiesField

> **SoupDatabaseRowSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `createdAt`: `string`; `createdBy?`: `string` \| `null`; `databaseId`: `string`; `id`: `string`; `ownerId`: `string`; `position`: `string`; `tableId`: `string`; `updatedAt`: `string`; \}

A row of a Macro database table in the Soup feed. Its cells are its
entity properties; access is its database's.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt` | `string` | Creation timestamp. |
| `createdBy?` | `string` \| `null` | Who created the row, when they still exist. |
| `databaseId` | `string` | The database the table belongs to. |
| `id` | `string` | Row identifier. |
| `ownerId` | `string` | The database's owner, which owns every row in it. |
| `position` | `string` | Fractional index ordering the row within its table. |
| `tableId` | `string` | The table the row belongs to. |
| `updatedAt` | `string` | Last modification timestamp. |
