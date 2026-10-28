# Type Alias: DatabaseWebhookPayloadProblem

> **DatabaseWebhookPayloadProblem** = \{ `field`: `string` \| `null`; `message`: `string`; `row`: `number` \| `null`; \}

One thing wrong with a webhook payload.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-field"></a> `field` | `string` \| `null` | The key at fault, when one is. |
| <a id="property-message"></a> `message` | `string` | What is wrong. |
| <a id="property-row"></a> `row` | `number` \| `null` | The row's index, when the payload is an array of rows. |
