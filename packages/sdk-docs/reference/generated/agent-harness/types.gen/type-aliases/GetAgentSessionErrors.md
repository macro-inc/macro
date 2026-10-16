# Type Alias: GetAgentSessionErrors

> **GetAgentSessionErrors** = \{ `401`: `string`; `403`: `string`; `404`: `string`; `500`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | `string` | the session exists but is not this caller's |
| <a id="property-403"></a> `403` | `string` | - |
| <a id="property-404"></a> `404` | `string` | no session with this id: not created yet, or deleted since |
| <a id="property-500"></a> `500` | `string` | - |
