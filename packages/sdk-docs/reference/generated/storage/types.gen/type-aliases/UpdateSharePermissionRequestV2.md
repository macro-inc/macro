# Type Alias: UpdateSharePermissionRequestV2

> **UpdateSharePermissionRequestV2** = \{ `channelSharePermissions?`: [`UpdateChannelSharePermission`](UpdateChannelSharePermission.md)[] \| `null`; `linkShare?`: `null` \| [`LinkShare`](LinkShare.md); `linkShareAccessLevel?`: `null` \| [`AccessLevel`](AccessLevel.md); `teamShareAccessLevel?`: `null` \| [`AccessLevel`](AccessLevel.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelsharepermissions"></a> `channelSharePermissions?` | [`UpdateChannelSharePermission`](UpdateChannelSharePermission.md)[] \| `null` | Any channel share permissions to be created/updated/removed |
| <a id="property-linkshare"></a> `linkShare?` | `null` \| [`LinkShare`](LinkShare.md) | - |
| <a id="property-linkshareaccesslevel"></a> `linkShareAccessLevel?` | `null` \| [`AccessLevel`](AccessLevel.md) | - |
| <a id="property-teamshareaccesslevel"></a> `teamShareAccessLevel?` | `null` \| [`AccessLevel`](AccessLevel.md) | - |
