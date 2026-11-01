# Type Alias: OpRefusalResponse

> **OpRefusalResponse** = \{ `column`: `string` \| `null`; `message`: `string`; `op`: `number`; `row`: `number` \| `null`; `taken`: `null` \| [`TakenId`](TakenId.md); \}

Why an op of a batch was refused. Nothing in the batch was written.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-column"></a> `column` | `string` \| `null` | The column placement at fault, when one is. |
| <a id="property-message"></a> `message` | `string` | What is wrong. |
| <a id="property-op"></a> `op` | `number` | The refused op's index in the request. |
| <a id="property-row"></a> `row` | `number` \| `null` | The row's index within the op, when one row is at fault. |
| <a id="property-taken"></a> `taken` | `null` \| [`TakenId`](TakenId.md) | - |
