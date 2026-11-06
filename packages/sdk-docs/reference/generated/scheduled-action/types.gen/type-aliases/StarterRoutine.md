# Type Alias: StarterRoutine

> **StarterRoutine** = \{ `key`: `string`; `request`: `string`; `steps`: \{\[`key`: `string`\]: `unknown`; \}[]; \}

A starter routine whose step is code: offered when a routine is created,
and shown to the drafter as a worked example.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-key"></a> `key` | `string` | Names it, e.g. `inbox`. |
| <a id="property-request"></a> `request` | `string` | What someone asks for, with when it runs. |
| <a id="property-steps"></a> `steps` | \{\[`key`: `string`\]: `unknown`; \}[] | Its steps, in the shape a routine's task holds them. |
