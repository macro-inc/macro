# Class: FormQuestion

One question, backed by a column. Its details never require reading the response table.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-form"></a> `form` | `readonly` | [`Form`](../../form/classes/Form.md) | The form that asks this question. |
| <a id="property-id"></a> `id` | `readonly` | `string` | The question's stable identifier within its form layout. |

## Methods

### column()

> **column**(): `Promise`\<[`DatabaseColumn`](../../../databases/column/classes/DatabaseColumn.md)\>

The column behind the question. Reading the column itself needs database access.

#### Returns

`Promise`\<[`DatabaseColumn`](../../../databases/column/classes/DatabaseColumn.md)\>

***

### detail()

> **detail**(): `Promise`\<[`FormQuestionDetail`](../../../../../generated/storage/types.gen/type-aliases/FormQuestionDetail.md)\>

The question's current presentation and column facts.

#### Returns

`Promise`\<[`FormQuestionDetail`](../../../../../generated/storage/types.gen/type-aliases/FormQuestionDetail.md)\>

***

### options()

> **options**(): `Promise`\<[`FormOption`](FormOption.md)[]\>

Current choices, in display order.

#### Returns

`Promise`\<[`FormOption`](FormOption.md)[]\>

***

### title()

> **title**(): `Promise`\<`string`\>

The question's current title (its column's name).

#### Returns

`Promise`\<`string`\>

***

### byId()

> `static` **byId**(`form`, `id`): `FormQuestion`

A question handle within a form.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `form` | [`Form`](../../form/classes/Form.md) |
| `id` | `string` |

#### Returns

`FormQuestion`
