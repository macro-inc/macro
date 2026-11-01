# Type Alias: CodeCheck

> **CodeCheck** = \{ `declarations`: `string`; `problems`: `string`[]; `sdk`: `string`; \}

What type-checking code found.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-declarations"></a> `declarations` | `string` | The SDK declarations the problems name, to fix them with. |
| <a id="property-problems"></a> `problems` | `string`[] | The first problems, as the type checker reported them; empty when it checks. |
| <a id="property-sdk"></a> `sdk` | `string` | The SDK the code was checked against. |
