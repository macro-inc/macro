# Type Alias: DraftedStep

> **DraftedStep** = \{ `problems`: `string`[]; `reason`: `string`; `step`: \{\[`key`: `string`\]: `unknown`; \}; \}

A drafted step.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-problems"></a> `problems` | `string`[] | What the type checker still finds in its code. |
| <a id="property-reason"></a> `reason` | `string` | Why AI made a step it chose code or Ask AI, in a few words; empty when it gave no short reason or didn't choose. |
| <a id="property-step"></a> `step` | \{\[`key`: `string`\]: `unknown`; \} | The step, in the shape a routine's task holds it. |
