# Class: FormResponse

A cached receipt for the caller's response; other respondents' receipts are private.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-form"></a> `form` | `readonly` | [`Form`](../../form/classes/Form.md) | The form that received this response. |
| <a id="property-id"></a> `id` | `readonly` | `string` | The response ledger entry's identifier. |

## Methods

### answers()

> **answers**(): `Promise`\<[`FormAnswer`](../../form/type-aliases/FormAnswer.md)[]\>

Answers as submitted or last read. Refresh to include later changes to the row.

#### Returns

`Promise`\<[`FormAnswer`](../../form/type-aliases/FormAnswer.md)[]\>

***

### booking()

> **booking**(): `Promise`\<[`FormBookingStep`](../../form/type-aliases/FormBookingStep.md) \| `undefined`\>

The booking step unlocked by this saved response, if any.

#### Returns

`Promise`\<[`FormBookingStep`](../../form/type-aliases/FormBookingStep.md) \| `undefined`\>

***

### refresh()

> **refresh**(): `Promise`\<`FormResponse`\>

Reload the caller's current receipt; requires a signed-in respondent.

#### Returns

`Promise`\<`FormResponse`\>

***

### row()

> **row**(): `Promise`\<[`DatabaseRow`](../../../databases/row/classes/DatabaseRow.md) \| `undefined`\>

The receipt's row, if any. Reading that row requires database access.

#### Returns

`Promise`\<[`DatabaseRow`](../../../databases/row/classes/DatabaseRow.md) \| `undefined`\>

***

### status()

> **status**(): `Promise`\<[`ResponseStatus`](../../../../../generated/storage/types.gen/type-aliases/ResponseStatus.md)\>

Whether this receipt was submitted or stopped by a gate.

#### Returns

`Promise`\<[`ResponseStatus`](../../../../../generated/storage/types.gen/type-aliases/ResponseStatus.md)\>

***

### byId()

> `static` **byId**(`form`, `id`, `snapshot?`): `FormResponse`

A response handle, optionally seeded with an already returned receipt.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `form` | [`Form`](../../form/classes/Form.md) |
| `id` | `string` |
| `snapshot?` | `ResponseSnapshot` |

#### Returns

`FormResponse`
