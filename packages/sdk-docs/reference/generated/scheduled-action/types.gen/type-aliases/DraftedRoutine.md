# Type Alias: DraftedRoutine

> **DraftedRoutine** = \{ `name`: `string`; `problems`: [`StepProblem`](StepProblem.md)[]; `steps`: \{\[`key`: `string`\]: `unknown`; \}[]; `trigger?`: `null` \| [`ActionTrigger`](ActionTrigger.md); \}

A drafted routine.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-problems"></a> `problems` | [`StepProblem`](StepProblem.md)[] | Steps whose code still fails the type checker. |
| <a id="property-steps"></a> `steps` | \{\[`key`: `string`\]: `unknown`; \}[] | What it does, in the shape a routine's task holds steps, each code step named as saving names it. |
| <a id="property-trigger"></a> `trigger?` | `null` \| [`ActionTrigger`](ActionTrigger.md) | - |
