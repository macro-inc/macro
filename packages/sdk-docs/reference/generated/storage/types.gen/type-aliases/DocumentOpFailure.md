# Type Alias: DocumentOpFailure

> **DocumentOpFailure** = \{ `index`: `number`; `kind`: `string`; `message`: `string`; \}

Why one op of a refused batch could not apply.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-index"></a> `index` | `number` | Position of the op in the submitted batch. |
| <a id="property-kind"></a> `kind` | `string` | Machine-readable failure kind, such as a missing node. |
| <a id="property-message"></a> `message` | `string` | What went wrong, for the program that built the op. |
