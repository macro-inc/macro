# Type Alias: UsageSnapshot

> **UsageSnapshot** = \{ `auto_reload`: [`AutoReloadSnapshot`](AutoReloadSnapshot.md); `blocked_reason?`: `null` \| [`DenyReason`](DenyReason.md); `can_manage_billing`: `boolean`; `credit_balance_cents`: `number`; `credits_consumed_cents`: `number`; `credits_shared_with_team`: `boolean`; `included_cents`: `number`; `overage_charged_cents`: `number`; `overage_enabled`: `boolean`; `overage_limit_cents`: `number`; `overage_suspended`: `boolean`; `payer`: `string`; `period_end`: `string`; `period_start`: `string`; `remaining_cents`: `number`; `seats`: `number`; `tier`: [`PlanTier`](PlanTier.md); `uncovered_cents`: `number`; `unlimited`: `boolean`; `used_cents`: `number`; \}

The payer's current-period position, as shown in Billing settings and used
by the gate.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_reload"></a> `auto_reload` | [`AutoReloadSnapshot`](AutoReloadSnapshot.md) | Automatic credit reload settings. `active` means the payer opted in and reloads are not suspended. |
| <a id="property-blocked_reason"></a> `blocked_reason?` | `null` \| [`DenyReason`](DenyReason.md) | - |
| <a id="property-can_manage_billing"></a> `can_manage_billing` | `boolean` | Whether the requesting user is the payer. |
| <a id="property-credit_balance_cents"></a> `credit_balance_cents` | `number` | Shared prepaid credit balance, in customer cents. |
| <a id="property-credits_consumed_cents"></a> `credits_consumed_cents` | `number` | Shared payer credits already applied to this period, in customer cents. |
| <a id="property-credits_shared_with_team"></a> `credits_shared_with_team` | `boolean` | Whether prepaid credits belong to the team, including a team with one seat. |
| <a id="property-included_cents"></a> `included_cents` | `number` | Included AI for this user's seat this period, in cents at provider cost. |
| <a id="property-overage_charged_cents"></a> `overage_charged_cents` | `number` | Shared overage charged so far this period, in customer cents. |
| <a id="property-overage_enabled"></a> `overage_enabled` | `boolean` | Legacy API name for the automatic reload opt-in. Never authorizes direct charges. |
| <a id="property-overage_limit_cents"></a> `overage_limit_cents` | `number` | Per-period overage cap, in customer cents. |
| <a id="property-overage_suspended"></a> `overage_suspended` | `boolean` | Whether overage is paused after a failed charge. |
| <a id="property-payer"></a> `payer` | `string` | The payer for this user's AI. |
| <a id="property-period_end"></a> `period_end` | `string` | Period end (exclusive). |
| <a id="property-period_start"></a> `period_start` | `string` | Period start. |
| <a id="property-remaining_cents"></a> `remaining_cents` | `number` | Cost cents of usage this seat may still consume: its remaining allowance plus whatever shared credit and overage headroom pays for at the markup. 0 when blocked. |
| <a id="property-seats"></a> `seats` | `number` | Seats billed to the payer. |
| <a id="property-tier"></a> `tier` | [`PlanTier`](PlanTier.md) | The plan. |
| <a id="property-uncovered_cents"></a> `uncovered_cents` | `number` | Team-wide usage beyond per-seat allowances, at the overage markup, that is not yet covered by shared credits or charges (awaiting settlement). Customer cents. |
| <a id="property-unlimited"></a> `unlimited` | `boolean` | Enterprise: never metered. |
| <a id="property-used_cents"></a> `used_cents` | `number` | AI used by this user this period, in cents at provider cost. |
