# Class: EditOutcomeUnknownError

An edit was sent but its outcome is unknown: the service reported a failure
after the edit started (HTTP 502), timed out (504), or the connection broke
with no response (status 0). It may have partly applied. Read the document
with `content()` before retrying; never replay the edit blindly.

## Extends

- [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md)

## Constructors

### Constructor

> **new EditOutcomeUnknownError**(`data`, `status?`): `EditOutcomeUnknownError`

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `data` | `unknown` | `undefined` |
| `status?` | `number` | `502` |

#### Returns

`EditOutcomeUnknownError`

#### Overrides

[`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`constructor`](../../../../utils/unwrap/classes/MacroApiError.md#constructor)

## Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-data"></a> `data` | `readonly` | `unknown` | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`data`](../../../../utils/unwrap/classes/MacroApiError.md#property-data) |
| <a id="property-status"></a> `status` | `readonly` | `number` | [`MacroApiError`](../../../../utils/unwrap/classes/MacroApiError.md).[`status`](../../../../utils/unwrap/classes/MacroApiError.md#property-status) |
