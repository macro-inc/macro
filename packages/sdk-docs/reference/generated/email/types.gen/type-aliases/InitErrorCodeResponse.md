# Type Alias: InitErrorCodeResponse

> **InitErrorCodeResponse** = \{ `code`: `string`; `message`: `string`; \}

Structured 400 body carrying a machine-readable code. Clients branch on
`code` instead of parsing the human message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `string` | Stable machine-readable error code. |
| <a id="property-message"></a> `message` | `string` | Human-readable explanation. |
