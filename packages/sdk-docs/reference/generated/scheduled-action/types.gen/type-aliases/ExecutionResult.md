# Type Alias: ExecutionResult

> **ExecutionResult** = \{ `condition?`: `null` \| [`ConditionResult`](ConditionResult.md); `configuration_revision?`: `number` \| `null`; `error?`: `string` \| `null`; `resource?`: `null` \| [`ExecutionResource`](ExecutionResource.md); `steps?`: \{\[`key`: `string`\]: `unknown`; \}[]; `version`: `number`; \}

Version 1 execution metadata stored in the existing JSON result column.
Null/string column values predate this envelope and refer to legacy chats.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-condition"></a> `condition?` | `null` \| [`ConditionResult`](ConditionResult.md) | - |
| <a id="property-configuration_revision"></a> `configuration_revision?` | `number` \| `null` | The routine configuration the run used. Step paths only name the same steps in that configuration; a later edit can put another step there. |
| <a id="property-error"></a> `error?` | `string` \| `null` | - |
| <a id="property-resource"></a> `resource?` | `null` \| [`ExecutionResource`](ExecutionResource.md) | - |
| <a id="property-steps"></a> `steps?` | \{\[`key`: `string`\]: `unknown`; \}[] | What each step that ran did, in order: decisions, tool calls, the agent. |
| <a id="property-version"></a> `version` | `number` | - |
