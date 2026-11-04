# Type Alias: SetHarnessTeamAccessRequest

> **SetHarnessTeamAccessRequest** = \{ `enabled`: `boolean`; `team_id`: `string`; \}

Request to open or close a runtime to one of the owner's teams.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-enabled"></a> `enabled` | `boolean` | Whether every member of the team may use the runtime. |
| <a id="property-team_id"></a> `team_id` | `string` | The team, which the owner must belong to. |
