# Class: MacroOpRefusedError

A batch of ops was refused (HTTP 400): nothing in it was written. Names the
op at fault and, when the batch minted an id that already names something
(a retry of a batch that committed, or an id minted twice), that id.

## Extends

- [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md)

## Constructors

### Constructor

> **new MacroOpRefusedError**(`status`, `refusal`): `MacroOpRefusedError`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `status` | `number` |
| `refusal` | [`OpRefusalResponse`](../../../../../generated/storage/types.gen/type-aliases/OpRefusalResponse.md) |

#### Returns

`MacroOpRefusedError`

#### Overrides

[`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`constructor`](../../../../utils/unwrap/classes/MacroApiError.md#constructor)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-column"></a> `column` | `readonly` | `string` \| `null` | The column placement at fault, when one is. | - |
| <a id="property-data"></a> `data` | `readonly` | `unknown` | - | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`data`](../../../../utils/unwrap/classes/MacroApiError.md#property-data) |
| <a id="property-op"></a> `op` | `readonly` | `number` | The refused op's index in the batch. | - |
| <a id="property-row"></a> `row` | `readonly` | `number` \| `null` | The row's index within the op, when one row is at fault. | - |
| <a id="property-status"></a> `status` | `readonly` | `number` | - | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`status`](../../../../utils/unwrap/classes/MacroApiError.md#property-status) |
| <a id="property-taken"></a> `taken` | `readonly` | [`TakenId`](../../../../../generated/storage/types.gen/type-aliases/TakenId.md) \| `null` | The minted id that is already taken, when that is the reason. | - |
