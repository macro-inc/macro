# Class: MacroForbiddenError

A 403: the caller lacks the access the request needs. Most often the user
can view the item but not edit it.

Agents: tell the user they can only view the item and offer to ask its owner
for edit access. Request it only with the user's go-ahead, by calling
`access.request('edit')` on the item (for example
`macro.initiatives.byId(id).access.request('edit')`); never request access
on your own. The request grants nothing: report that it is pending and who
reviews it (`access.state()` returns the `owner`), and do not claim the
write succeeded. Check `access.state()` later and retry the write only once
`accessLevel` allows it.

The server does not say which item refused the write. A write that touches
two items, such as setting a task's Project (or another property that
references an item), needs edit access to both: read `access.state()` on
each and request access on the one whose `accessLevel` is below `edit`.

## Extends

- [`MacroApiError`](MacroApiError.md)

## Constructors

### Constructor

> **new MacroForbiddenError**(`data`): `MacroForbiddenError`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `data` | `unknown` |

#### Returns

`MacroForbiddenError`

#### Overrides

[`MacroApiError`](MacroApiError.md).[`constructor`](MacroApiError.md#constructor)

## Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-data"></a> `data` | `readonly` | `unknown` | [`MacroApiError`](MacroApiError.md).[`data`](MacroApiError.md#property-data) |
| <a id="property-status"></a> `status` | `readonly` | `number` | [`MacroApiError`](MacroApiError.md).[`status`](MacroApiError.md#property-status) |
