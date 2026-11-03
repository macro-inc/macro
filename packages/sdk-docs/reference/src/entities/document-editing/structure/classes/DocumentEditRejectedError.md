# Class: DocumentEditRejectedError

Ops in a structured batch failed against the live document (HTTP 422), so
nothing was committed: a node someone deleted, or text no longer there.
Read `structure()` again and rebuild the batch.

## Extends

- [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md)

## Constructors

### Constructor

> **new DocumentEditRejectedError**(`rejection`): `DocumentEditRejectedError`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `rejection` | [`DocumentEditRejected`](../../../../../generated/storage/types.gen/type-aliases/DocumentEditRejected.md) |

#### Returns

`DocumentEditRejectedError`

#### Overrides

[`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`constructor`](../../../../utils/unwrap/classes/MacroApiError.md#constructor)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-data"></a> `data` | `readonly` | `unknown` | - | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`data`](../../../../utils/unwrap/classes/MacroApiError.md#property-data) |
| <a id="property-failures"></a> `failures` | `readonly` | [`DocumentOpFailure`](../../../../../generated/storage/types.gen/type-aliases/DocumentOpFailure.md)[] | Each failed op, by its index in the batch, with the reason. | - |
| <a id="property-status"></a> `status` | `readonly` | `number` | - | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`status`](../../../../utils/unwrap/classes/MacroApiError.md#property-status) |
