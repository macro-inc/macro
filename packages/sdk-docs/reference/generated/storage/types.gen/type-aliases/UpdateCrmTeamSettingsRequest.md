# Type Alias: UpdateCrmTeamSettingsRequest

> **UpdateCrmTeamSettingsRequest** = \{ `closed_stage_ids?`: `string`[] \| `null`; `default_team_view_id?`: `string` \| `null`; `delete_records_role?`: `null` \| [`CrmPermissionRole`](CrmPermissionRole.md); `edit_stages_role?`: `null` \| [`CrmPermissionRole`](CrmPermissionRole.md); `move_closed_deals_role?`: `null` \| [`CrmPermissionRole`](CrmPermissionRole.md); `team_views?`: `unknown`; \}

Request body for `PUT /crm/settings`. Every field is optional:
omitted fields keep their current values.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-closed_stage_ids"></a> `closed_stage_ids?` | `string`[] \| `null` | New closed-stage set. Omit to keep the current value; pass `null` to clear it (falling back to the client label heuristic). |
| <a id="property-default_team_view_id"></a> `default_team_view_id?` | `string` \| `null` | New default team view id. Omit to keep the current value; pass `null` to clear it. |
| <a id="property-delete_records_role"></a> `delete_records_role?` | `null` \| [`CrmPermissionRole`](CrmPermissionRole.md) | - |
| <a id="property-edit_stages_role"></a> `edit_stages_role?` | `null` \| [`CrmPermissionRole`](CrmPermissionRole.md) | - |
| <a id="property-move_closed_deals_role"></a> `move_closed_deals_role?` | `null` \| [`CrmPermissionRole`](CrmPermissionRole.md) | - |
| <a id="property-team_views"></a> `team_views?` | `unknown` | Replacement team-views array (whole-blob, last write wins). |
