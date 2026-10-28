# Type Alias: InitiativeDetail

> **InitiativeDetail** = \{ `createdAt`: `string`; `id`: [`InitiativeId`](InitiativeId.md); `memberIds`: [`MacroUserIdStr`](MacroUserIdStr.md)[]; `name`: `string`; `ownerId`: [`MacroUserIdStr`](MacroUserIdStr.md); `sharePermission`: [`SharePermissionV2`](SharePermissionV2.md); `taskIds`: `string`[]; `updatedAt`: `string`; `userAccessLevel`: [`AccessLevel`](AccessLevel.md); \}

Full initiative returned to a caller, including members, tasks, and share state.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When the initiative was created. |
| <a id="property-id"></a> `id` | [`InitiativeId`](InitiativeId.md) | Opaque identifier. |
| <a id="property-memberids"></a> `memberIds` | [`MacroUserIdStr`](MacroUserIdStr.md)[] | Member user ids. The owner is never stored here. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-ownerid"></a> `ownerId` | [`MacroUserIdStr`](MacroUserIdStr.md) | Owner of the initiative. |
| <a id="property-sharepermission"></a> `sharePermission` | [`SharePermissionV2`](SharePermissionV2.md) | Current share permission. |
| <a id="property-taskids"></a> `taskIds` | `string`[] | Task ids currently assigned to the initiative. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When the initiative was last updated. |
| <a id="property-useraccesslevel"></a> `userAccessLevel` | [`AccessLevel`](AccessLevel.md) | Caller's access level on this initiative. |
