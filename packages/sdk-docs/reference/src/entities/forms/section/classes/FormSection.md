# Class: FormSection

An ordered group of questions, or a gate between groups.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-form"></a> `form` | `readonly` | [`Form`](../../form/classes/Form.md) | The owning form. |
| <a id="property-id"></a> `id` | `readonly` | `string` | The section's stable identifier. |

## Methods

### detail()

> **detail**(): `Promise`\<[`FormSectionDetail`](../../../../../generated/storage/types.gen/type-aliases/FormSectionDetail.md)\>

The section's current presentation.

#### Returns

`Promise`\<[`FormSectionDetail`](../../../../../generated/storage/types.gen/type-aliases/FormSectionDetail.md)\>

***

### questions()

> **questions**(): `Promise`\<[`FormQuestion`](../../question/classes/FormQuestion.md)[]\>

Questions in display order; gates contain no questions.

#### Returns

`Promise`\<[`FormQuestion`](../../question/classes/FormQuestion.md)[]\>

***

### title()

> **title**(): `Promise`\<`string`\>

The section heading.

#### Returns

`Promise`\<`string`\>

***

### byId()

> `static` **byId**(`form`, `id`): `FormSection`

A section handle within a form.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `form` | [`Form`](../../form/classes/Form.md) |
| `id` | `string` |

#### Returns

`FormSection`
