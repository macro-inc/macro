# Type Alias: CrmTeamSettingsResponse

> **CrmTeamSettingsResponse** = \{ `closed_stage_ids?`: `string`[] \| `null`; `default_team_view_id?`: `string` \| `null`; `delete_records_role`: [`CrmPermissionRole`](CrmPermissionRole.md); `edit_stages_role`: [`CrmPermissionRole`](CrmPermissionRole.md); `legacy_stage_ids`: \{\[`key`: `string`\]: `string`; \}; `move_closed_deals_role`: [`CrmPermissionRole`](CrmPermissionRole.md); `team_views`: `unknown`; \}

The team's CRM configuration (everything on `team_crm_settings`
except the `crm_enabled` killswitch, which is managed via
`PATCH /team/crm` on the auth service).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-closed_stage_ids"></a> `closed_stage_ids?` | `string`[] \| `null` | Stage option ids counting as closed deals; absent = the client falls back to its label heuristic. |
| <a id="property-default_team_view_id"></a> `default_team_view_id?` | `string` \| `null` | Team view applied by default when a member opens the CRM view. |
| <a id="property-delete_records_role"></a> `delete_records_role` | [`CrmPermissionRole`](CrmPermissionRole.md) | Who can delete (hide) CRM records. |
| <a id="property-edit_stages_role"></a> `edit_stages_role` | [`CrmPermissionRole`](CrmPermissionRole.md) | Who can change the deal stage set in CRM settings. |
| <a id="property-legacy_stage_ids"></a> `legacy_stage_ids` | \{\[`key`: `string`\]: `string`; \} | System stage option id to team stage option id for seeded stages. |
| <a id="property-move_closed_deals_role"></a> `move_closed_deals_role` | [`CrmPermissionRole`](CrmPermissionRole.md) | Who can move deals out of a closed stage. |
| <a id="property-team_views"></a> `team_views` | `unknown` | Team saved views — an opaque JSON array owned by the frontend. |
