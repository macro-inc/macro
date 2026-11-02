# Type Alias: RoutineLimitErrorBody

> **RoutineLimitErrorBody** = \{ `code`: [`RoutineLimitCode`](RoutineLimitCode.md); `error`: `string`; `limit`: `number`; `plan`: [`PlanTier`](PlanTier.md); \}

A write that would activate more routines than the owner's plan allows.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | [`RoutineLimitCode`](RoutineLimitCode.md) | - |
| <a id="property-error"></a> `error` | `string` | Human-readable explanation. |
| <a id="property-limit"></a> `limit` | `number` | How many routines the plan allows to be active at once. |
| <a id="property-plan"></a> `plan` | [`PlanTier`](PlanTier.md) | The plan the limit comes from. |
