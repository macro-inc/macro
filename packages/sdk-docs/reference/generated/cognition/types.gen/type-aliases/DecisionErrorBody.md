# Type Alias: DecisionErrorBody

> **DecisionErrorBody** = \{ `code`: `string`; `error`: `string`; \}

Sanitized, machine-readable failure of a decision request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `string` | Stable failure code. |
| <a id="property-error"></a> `error` | `string` | Human-readable explanation without provider credentials or diagnostics. |
