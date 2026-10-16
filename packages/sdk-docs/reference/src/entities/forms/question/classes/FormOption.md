# Class: FormOption

A choice of one form question, resolved through that question's current options.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | The backing database option's identifier. |
| <a id="property-question"></a> `question` | `readonly` | [`FormQuestion`](FormQuestion.md) | The question offering this choice. |

## Methods

### color()

> **color**(): `Promise`\<`string` \| `undefined`\>

The choice's color, when one is set.

#### Returns

`Promise`\<`string` \| `undefined`\>

***

### detail()

> **detail**(): `Promise`\<[`QuestionOption`](../../../../../generated/storage/types.gen/type-aliases/QuestionOption.md)\>

The choice's label and color.

#### Returns

`Promise`\<[`QuestionOption`](../../../../../generated/storage/types.gen/type-aliases/QuestionOption.md)\>

***

### label()

> **label**(): `Promise`\<`string`\>

The choice's label.

#### Returns

`Promise`\<`string`\>

***

### byId()

> `static` **byId**(`question`, `id`): `FormOption`

A handle to a known choice of a question.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `question` | [`FormQuestion`](FormQuestion.md) |
| `id` | `string` |

#### Returns

`FormOption`
