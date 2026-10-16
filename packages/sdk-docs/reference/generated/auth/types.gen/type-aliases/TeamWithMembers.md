# Type Alias: TeamWithMembers

> **TeamWithMembers** = \{ `members`: [`TeamMember`](TeamMember.md)[]; `scheduled_seat_plans?`: \{\[`key`: `string`\]: [`ScheduledSeatPlan`](ScheduledSeatPlan.md); \} \| `null`; `team`: [`Team`](Team.md); \}

A team with its members

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-members"></a> `members` | [`TeamMember`](TeamMember.md)[] | The members of the team |
| <a id="property-scheduled_seat_plans"></a> `scheduled_seat_plans?` | \{\[`key`: `string`\]: [`ScheduledSeatPlan`](ScheduledSeatPlan.md); \} \| `null` | Provider-confirmed pending seat changes, keyed by member user ID. Empty when no changes apply to this viewer; absent when the lookup fails. |
| <a id="property-team"></a> `team` | [`Team`](Team.md) | The team |
