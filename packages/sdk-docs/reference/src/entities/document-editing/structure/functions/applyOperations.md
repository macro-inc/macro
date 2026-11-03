# Function: applyOperations()

> **applyOperations**(`client`, `document`, `operations`, `signal`): `Promise`\<[`StructuredEditResult`](../interfaces/StructuredEditResult.md)\>

Send a structured batch; `applyEdits` and `insertDatabaseQuery` share it.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `document` | [`Document`](../../../documents/document/classes/Document.md) |
| `operations` | [`DocumentOp`](../../../../vendor/editor-ops/src/document/ops/type-aliases/DocumentOp.md)[] |
| `signal` | `AbortSignal` \| `undefined` |

## Returns

`Promise`\<[`StructuredEditResult`](../interfaces/StructuredEditResult.md)\>
