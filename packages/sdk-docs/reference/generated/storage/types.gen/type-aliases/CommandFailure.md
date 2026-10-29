# Type Alias: CommandFailure

> **CommandFailure** = \{ `code`: `string`; `message`: `string`; `retryable`: `boolean`; \}

Sanitized public details of a command refused before runtime execution.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `string` | Stable public denial or unavailability code. |
| <a id="property-message"></a> `message` | `string` | Public explanation, never an internal error report. |
| <a id="property-retryable"></a> `retryable` | `boolean` | Whether retrying later may succeed without a policy change. |
