# Type Alias: SoupChatSoupPropertiesField

> **SoupChatSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `createdAt`: `string`; `deletedAt?`: `string` \| `null`; `id`: `string`; `isPersistent`: `boolean`; `model?`: `string` \| `null`; `name`: `string`; `ownerId`: `string`; `projectId?`: `string` \| `null`; `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; \}

A chat as displayed in Soup.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt` | `string` | The time the chat was created |
| `deletedAt?` | `string` \| `null` | The time the chat was deleted |
| `id` | `string` | The chat uuid |
| `isPersistent` | `boolean` | Whether the chat is persistent or not |
| `model?` | `string` \| `null` | The last model selected for a sent message (`provider/model` id). |
| `name` | `string` | The name of the chat |
| `ownerId` | `string` | Who the chat belongs to |
| `projectId?` | `string` \| `null` | The project id of the chat |
| `updatedAt` | `string` | The time the chat was last updated |
| `viewedAt?` | `string` \| `null` | The time the chat was last viewed |
