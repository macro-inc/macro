# Type Alias: RecordedToolCall

> **RecordedToolCall** = \{ `error?`: `string` \| `null`; `id`: `string`; `input`: `unknown`; `name`: `string`; `output?`: `unknown`; `outputOmitted`: `boolean`; `status`: [`RecordedCallStatus`](RecordedCallStatus.md); \}

A real inner call, recorded by trusted dispatch for the existing renderers.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error?` | `string` \| `null` | Safe tool failure, if one was returned. |
| <a id="property-id"></a> `id` | `string` | Stable, execution-scoped component identity. |
| <a id="property-input"></a> `input` | `unknown` | Arguments passed to the actual tool. |
| <a id="property-name"></a> `name` | `string` | Canonical Macro tool name from the allowlisted registry. |
| <a id="property-output"></a> `output?` | `unknown` | Original tool output, retained independently of the program's return value. |
| <a id="property-outputomitted"></a> `outputOmitted` | `boolean` | Whether the response was omitted to keep the durable journal bounded. |
| <a id="property-status"></a> `status` | [`RecordedCallStatus`](RecordedCallStatus.md) | A started call that never replied has an unknown side-effect outcome. |
