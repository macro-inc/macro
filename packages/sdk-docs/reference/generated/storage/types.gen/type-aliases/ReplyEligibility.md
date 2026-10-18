# Type Alias: ReplyEligibility

> **ReplyEligibility** = \{ `evaluated_at`: `string`; `modes`: [`ModeEligibility`](ModeEligibility.md)[]; \}

Eligibility is a snapshot, re-evaluated before dispatch.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-evaluated_at"></a> `evaluated_at` | `string` | Server time used to evaluate every mode in this response. |
| <a id="property-modes"></a> `modes` | [`ModeEligibility`](ModeEligibility.md)[] | Current decisions, separate from static implemented support. |
