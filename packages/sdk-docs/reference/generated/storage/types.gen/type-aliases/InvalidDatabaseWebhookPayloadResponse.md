# Type Alias: InvalidDatabaseWebhookPayloadResponse

> **InvalidDatabaseWebhookPayloadResponse** = \{ `message`: `string`; `problems`: [`DatabaseWebhookPayloadProblem`](DatabaseWebhookPayloadProblem.md)[]; \}

Why a payload was refused. Nothing was written.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-message"></a> `message` | `string` | A summary. |
| <a id="property-problems"></a> `problems` | [`DatabaseWebhookPayloadProblem`](DatabaseWebhookPayloadProblem.md)[] | Every problem found. |
