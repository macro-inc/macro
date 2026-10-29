# Type Alias: WebhookValidationTestEvent

> **WebhookValidationTestEvent** = \{ `event`: `string`; `id`: `string`; `webhook_id`: [`String`](String.md); \}

Body of the `webhook.validation.test` delivery sent when validating an
endpoint. Not part of the `WebhookEvent` entity-event union.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-event"></a> `event` | `string` | Event name; always `webhook.validation.test`. |
| <a id="property-id"></a> `id` | `string` | Event id, with an `evt_` prefix. |
| <a id="property-webhook_id"></a> `webhook_id` | [`String`](String.md) | Webhook being validated. |
