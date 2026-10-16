# Type Alias: SoupInitiativeSoupPropertiesField

> **SoupInitiativeSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `createdAt`: `string`; `id`: `string`; `name`: `string`; `ownerId`: `string`; `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; \}

An initiative (called a project in the frontend) in the Soup feed.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt` | `string` | Creation timestamp. |
| `id` | `string` | Initiative identifier. |
| `name` | `string` | Initiative display name. |
| `ownerId` | `string` | Initiative owner. |
| `updatedAt` | `string` | Last modification timestamp. |
| `viewedAt?` | `string` \| `null` | Last time the requesting user viewed the initiative. |
