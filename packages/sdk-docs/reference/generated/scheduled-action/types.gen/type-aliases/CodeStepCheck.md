# Type Alias: CodeStepCheck

> **CodeStepCheck** = \{ `declarations`: `string`; `index`: `number`; `problems`: `string`[]; `title`: `string`; \}

A code step's problems, and what to fix them with.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-declarations"></a> `declarations` | `string` | The SDK declarations the problems name. |
| <a id="property-index"></a> `index` | `number` | Which code step, counted in program order from zero. |
| <a id="property-problems"></a> `problems` | `string`[] | The first problems, as the type checker reported them. |
| <a id="property-title"></a> `title` | `string` | Its title. |
