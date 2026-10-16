# Type Alias: PatchTeamRequest

> **PatchTeamRequest** = \{ `default_link_share?`: `null` \| [`LinkShare`](LinkShare.md); `name?`: `string` \| `null`; `slug?`: `string` \| `null`; `user_role_updates?`: [`PatchTeamUserRole`](PatchTeamUserRole.md)[] \| `null`; \}

Request to update a team

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-default_link_share"></a> `default_link_share?` | `null` \| [`LinkShare`](LinkShare.md) | - |
| <a id="property-name"></a> `name?` | `string` \| `null` | The new name for the team |
| <a id="property-slug"></a> `slug?` | `string` \| `null` | The new slug for the team. This is normalized to SCREAMING_SNAKE_CASE. |
| <a id="property-user_role_updates"></a> `user_role_updates?` | [`PatchTeamUserRole`](PatchTeamUserRole.md)[] \| `null` | Role updates to apply to team users |
