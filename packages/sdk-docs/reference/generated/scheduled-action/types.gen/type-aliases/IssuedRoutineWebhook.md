# Type Alias: IssuedRoutineWebhook

> **IssuedRoutineWebhook** = [`RoutineWebhook`](RoutineWebhook.md) & \{ `token`: `string`; \}

A newly issued webhook URL token. The token is never available again.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | Secret path segment: POST to `/scheduled-actions/webhooks/{token}`. |
