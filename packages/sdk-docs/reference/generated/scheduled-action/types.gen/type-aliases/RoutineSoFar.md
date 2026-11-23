# Type Alias: RoutineSoFar

> **RoutineSoFar** = \{ `steps`: \{\[`key`: `string`\]: `unknown`; \}[]; `trigger?`: \{\[`key`: `string`\]: `unknown`; \} \| `null`; \}

The routine a step is added to or changed in.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-steps"></a> `steps` | \{\[`key`: `string`\]: `unknown`; \}[] | Its steps, in the shape a routine's task holds them. |
| <a id="property-trigger"></a> `trigger?` | \{\[`key`: `string`\]: `unknown`; \} \| `null` | Its trigger as it would be saved, for AI to read; absent while it has none. |
