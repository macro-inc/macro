# Type Alias: SoupProjectSoupPropertiesField

> **SoupProjectSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `createdAt`: `string`; `deletedAt?`: `string` \| `null`; `id`: `string`; `name`: `string`; `ownerId`: `string`; `parentId?`: `string` \| `null`; `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; \}

A project as displayed in Soup.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt` | `string` | The time the project was created |
| `deletedAt?` | `string` \| `null` | The time the project was deleted |
| `id` | `string` | The id of the project |
| `name` | `string` | The name of the project |
| `ownerId` | `string` | The owner of the project |
| `parentId?` | `string` \| `null` | The parent project id |
| `updatedAt` | `string` | The time the project was updated |
| `viewedAt?` | `string` \| `null` | The time the document was last viewed |
