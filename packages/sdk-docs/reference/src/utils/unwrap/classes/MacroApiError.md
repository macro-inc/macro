# Class: MacroApiError

A non-2xx HTTP response (Macro API, or a raw fetch like presigned downloads).
The message includes the server's explanation, such as a validation error,
and `data` holds the parsed error body.

## Extends

- [`MacroError`](MacroError.md)

## Extended by

- [`MacroOpRefusedError`](../../../entities/databases/database/classes/MacroOpRefusedError.md)

## Constructors

### Constructor

> **new MacroApiError**(`status`, `data`): `MacroApiError`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `status` | `number` |
| `data` | `unknown` |

#### Returns

`MacroApiError`

#### Overrides

[`MacroError`](MacroError.md).[`constructor`](MacroError.md#constructor)

## Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-data"></a> `data` | `readonly` | `unknown` |
| <a id="property-status"></a> `status` | `readonly` | `number` |
