# Type Alias: CodeGuide

> **CodeGuide** = \{ `contract`: `string`; `examples`: [`StarterRoutine`](StarterRoutine.md)[]; `reference`: `string`; `sdk`: `string`; `steps`: `string`; \}

How to write a code step for a described task.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-contract"></a> `contract` | `string` | TypeScript declaring `StepContext`, what `main` receives. |
| <a id="property-examples"></a> `examples` | [`StarterRoutine`](StarterRoutine.md)[] | Starter routines, as worked examples of code steps. |
| <a id="property-reference"></a> `reference` | `string` | The SDK's entities relevant to the task, with method signatures. |
| <a id="property-sdk"></a> `sdk` | `string` | The version code is checked against: the SDK and the step contract. |
| <a id="property-steps"></a> `steps` | `string` | How to write a code step, the same text the routine agent tools read. |
