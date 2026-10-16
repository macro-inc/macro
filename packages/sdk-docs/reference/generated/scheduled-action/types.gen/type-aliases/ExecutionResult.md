# Type Alias: ExecutionResult

> **ExecutionResult** = \{ `condition?`: `null` \| [`ConditionResult`](ConditionResult.md); `error?`: `string` \| `null`; `resource?`: `null` \| [`ExecutionResource`](ExecutionResource.md); `version`: `number`; \}

Version 1 execution metadata stored in the existing JSON result column.
Null/string column values predate this envelope and refer to legacy chats.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-condition"></a> `condition?` | `null` \| [`ConditionResult`](ConditionResult.md) |
| <a id="property-error"></a> `error?` | `string` \| `null` |
| <a id="property-resource"></a> `resource?` | `null` \| [`ExecutionResource`](ExecutionResource.md) |
| <a id="property-version"></a> `version` | `number` |
