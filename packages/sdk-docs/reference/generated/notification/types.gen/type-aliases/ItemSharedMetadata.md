# Type Alias: ItemSharedMetadata

> **ItemSharedMetadata** = \{ `itemId`: `string`; `itemName?`: `string` \| `null`; `itemType`: [`EntityType`](EntityType.md); `permissionLevel?`: `string` \| `null`; `sharedBy`: `string`; `userIds`: `string`[]; \}

Metadata for when a item is shared with a user

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-itemid"></a> `itemId` | `string` | The name/title of the shared item (optional) |
| <a id="property-itemname"></a> `itemName?` | `string` \| `null` | The name/title of the shared item |
| <a id="property-itemtype"></a> `itemType` | [`EntityType`](EntityType.md) | The type of item being shared |
| <a id="property-permissionlevel"></a> `permissionLevel?` | `string` \| `null` | Permission level granted (read, write, admin, etc.) |
| <a id="property-sharedby"></a> `sharedBy` | `string` | - |
| <a id="property-userids"></a> `userIds` | `string`[] | List of user IDs that the item is shared with |
