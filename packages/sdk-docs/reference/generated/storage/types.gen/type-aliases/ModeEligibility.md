# Type Alias: ModeEligibility

> **ModeEligibility** = \{ `allowed`: `boolean`; `expires_at?`: `string` \| `null`; `mode`: [`ReplyMode`](ReplyMode.md); `reason?`: `null` \| [`ReplyBlockReason`](ReplyBlockReason.md); \}

Current server decision for one implemented sending mode.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allowed"></a> `allowed` | `boolean` | True only when every current server-side condition is satisfied. |
| <a id="property-expires_at"></a> `expires_at?` | `string` \| `null` | An allowed control may expire locally; the browser cannot extend permission. |
| <a id="property-mode"></a> `mode` | [`ReplyMode`](ReplyMode.md) | Explicit operation whose eligibility was evaluated. |
| <a id="property-reason"></a> `reason?` | `null` \| [`ReplyBlockReason`](ReplyBlockReason.md) | - |
