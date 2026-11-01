# Type Alias: TeamMember

> **TeamMember** = \{ `plan`: [`SeatPlan`](SeatPlan.md); `role`: [`TeamRole`](TeamRole.md); `team_id`: `string`; `user_id`: `string`; \}

The team member struct

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-plan"></a> `plan` | [`SeatPlan`](SeatPlan.md) | The paid plan the member's seat is billed at. Meaningful on paying and enterprise teams; free-team members carry the default. |
| <a id="property-role"></a> `role` | [`TeamRole`](TeamRole.md) | The role of the team member |
| <a id="property-team_id"></a> `team_id` | `string` | The id of the team |
| <a id="property-user_id"></a> `user_id` | `string` | The user id of the team member |
