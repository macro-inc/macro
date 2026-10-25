# Type Alias: SharePermissionOptions

> **SharePermissionOptions** = `Omit`\<[`UpdateSharePermissionRequestV2`](../../../../../generated/storage/types.gen/type-aliases/UpdateSharePermissionRequestV2.md), `"channelSharePermissions"`\> & \{ `channelSharePermissions?`: \{ `accessLevel?`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md); `channel`: [`Channel`](../../../channels/channel/classes/Channel.md); `operation`: [`UpdateChannelSharePermission`](../../../../../generated/storage/types.gen/type-aliases/UpdateChannelSharePermission.md)\[`"operation"`\]; \}[] \| `null`; \}

Sharing updates reference channels by handle. Null clears the corresponding grant collection.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `channelSharePermissions?` | \{ `accessLevel?`: [`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md); `channel`: [`Channel`](../../../channels/channel/classes/Channel.md); `operation`: [`UpdateChannelSharePermission`](../../../../../generated/storage/types.gen/type-aliases/UpdateChannelSharePermission.md)\[`"operation"`\]; \}[] \| `null` | Channel grants to create or replace. |
