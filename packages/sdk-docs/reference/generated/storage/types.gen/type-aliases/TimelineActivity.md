# Type Alias: TimelineActivity

> **TimelineActivity** = \{ `action`: `string`; `actor_id`: `string`; `id`: `string`; `occurred_at`: `string`; `payload?`: `unknown`; \}

A displayable fact returned together with a message page.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action"></a> `action` | `string` | Durable action tag. Unknown tags remain representable during rollouts. |
| <a id="property-actor_id"></a> `actor_id` | `string` | Principal who performed the action. |
| <a id="property-id"></a> `id` | `string` | Stable activity identity, independent of message ids. |
| <a id="property-occurred_at"></a> `occurred_at` | `string` | Immutable chronological position. |
| <a id="property-payload"></a> `payload?` | `unknown` | The action's stored payload. |
