# Type Alias: ScheduledSeatPlan

> **ScheduledSeatPlan** = \{ `effectiveAt`: `string`; `plan`: [`SeatPlan`](SeatPlan.md); \}

A seat's future plan in the subscription's currently attached schedule.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-effectiveat"></a> `effectiveAt` | `string` | Provider-confirmed time when the future phase starts. |
| <a id="property-plan"></a> `plan` | [`SeatPlan`](SeatPlan.md) | Plan that takes effect at renewal. |
