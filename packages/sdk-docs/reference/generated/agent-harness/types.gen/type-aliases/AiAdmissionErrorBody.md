# Type Alias: AiAdmissionErrorBody

> **AiAdmissionErrorBody** = \{ `code`: `string`; `error`: `string`; \}

Public admission error payload. Handlers with additional fields can reuse the
domain error's code and message and [`admission_status`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `string` | Stable denial or unavailability code. |
| <a id="property-error"></a> `error` | `string` | Human-readable explanation, without internal billing diagnostics. |
