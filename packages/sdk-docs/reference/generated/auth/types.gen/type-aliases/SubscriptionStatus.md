# Type Alias: SubscriptionStatus

> **SubscriptionStatus** = \{ `renewalDate?`: `string` \| `null`; `scheduledChange?`: `null` \| [`ScheduledSeatPlan`](ScheduledSeatPlan.md); \}

Current renewal and scheduled change; empty for accounts without a subscription.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-renewaldate"></a> `renewalDate?` | `string` \| `null` | Provider-confirmed subscription renewal date. |
| <a id="property-scheduledchange"></a> `scheduledChange?` | `null` \| [`ScheduledSeatPlan`](ScheduledSeatPlan.md) | - |
