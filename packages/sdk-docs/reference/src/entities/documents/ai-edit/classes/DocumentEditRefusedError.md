# Class: DocumentEditRefusedError

The editor can't do the edit as instructed (HTTP 422): the instructions are
ambiguous, name text that isn't there, or pass an invalid block. Nothing
changed. `reason` says what it needs; rewrite the instructions.

## Extends

- [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md)

## Constructors

### Constructor

> **new DocumentEditRefusedError**(`refusal`): `DocumentEditRefusedError`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `refusal` | [`DocumentAiEditRefused`](../../../../../generated/storage/types.gen/type-aliases/DocumentAiEditRefused.md) |

#### Returns

`DocumentEditRefusedError`

#### Overrides

[`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`constructor`](../../../../utils/unwrap/classes/MacroApiError.md#constructor)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-data"></a> `data` | `readonly` | `unknown` | - | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`data`](../../../../utils/unwrap/classes/MacroApiError.md#property-data) |
| <a id="property-reason"></a> `reason` | `readonly` | `string` | Why the editor refused, in its words. | - |
| <a id="property-status"></a> `status` | `readonly` | `number` | - | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`status`](../../../../utils/unwrap/classes/MacroApiError.md#property-status) |
