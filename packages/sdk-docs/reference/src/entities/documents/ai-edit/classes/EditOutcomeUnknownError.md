# Class: EditOutcomeUnknownError

An edit was sent but its outcome is unknown (HTTP 502): it may have applied,
in part for an instructions edit. Read `structure()` before retrying; never
replay the edit blindly.

## Extends

- [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md)

## Constructors

### Constructor

> **new EditOutcomeUnknownError**(`data`): `EditOutcomeUnknownError`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `data` | `unknown` |

#### Returns

`EditOutcomeUnknownError`

#### Overrides

[`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`constructor`](../../../../utils/unwrap/classes/MacroApiError.md#constructor)

## Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-data"></a> `data` | `readonly` | `unknown` | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`data`](../../../../utils/unwrap/classes/MacroApiError.md#property-data) |
| <a id="property-status"></a> `status` | `readonly` | `number` | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`status`](../../../../utils/unwrap/classes/MacroApiError.md#property-status) |
