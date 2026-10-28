# Type Alias: PatchTeamMemberPlanRequest

> **PatchTeamMemberPlanRequest** = \{ `plan`: [`SeatPlan`](SeatPlan.md); \}

Request body for `PATCH /team/members/{member_user_id}/plan`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-plan"></a> `plan` | [`SeatPlan`](SeatPlan.md) | The plan to bill the member's seat at from now on. |
