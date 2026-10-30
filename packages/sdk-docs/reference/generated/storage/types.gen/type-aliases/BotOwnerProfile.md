# Type Alias: BotOwnerProfile

> **BotOwnerProfile** = \{ `avatar_url?`: `string` \| `null`; `deleted_at?`: `string` \| `null`; `id`: [`BotId`](BotId.md); `name`: `string`; `owner?`: `null` \| [`BotOwner`](BotOwner.md); \}

Bot identity for rendering, including the sponsor and soft-delete time.

`owner` is none only for a registry system bot. A persisted row always has
a sponsor.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-avatar_url"></a> `avatar_url?` | `string` \| `null` | Avatar URL. Registry system bots have none. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Soft-delete time. Absent for an active bot and for a registry system bot. |
| <a id="property-id"></a> `id` | [`BotId`](BotId.md) | Bot id. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-owner"></a> `owner?` | `null` \| [`BotOwner`](BotOwner.md) | - |
