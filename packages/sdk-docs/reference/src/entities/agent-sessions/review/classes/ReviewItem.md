# Class: ReviewItem

An item handle scopes edits and decisions to its persisted review.

## Constructors

### Constructor

> **new ReviewItem**(`snapshot`, `actions`): `ReviewItem`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `snapshot` | [`ReviewItem`](../../../../../generated/agent-harness/types.gen/type-aliases/ReviewItem.md) |
| `actions` | \{ `dismiss`: () => `Promise`\<`void`\>; `edit`: (`draft`) => `Promise`\<`void`\>; `submit`: () => `Promise`\<`void`\>; \} |
| `actions.dismiss` | () => `Promise`\<`void`\> |
| `actions.edit` | (`draft`) => `Promise`\<`void`\> |
| `actions.submit` | () => `Promise`\<`void`\> |

#### Returns

`ReviewItem`

## Accessors

### draft

#### Get Signature

> **get** **draft**(): `unknown`

##### Returns

`unknown`

***

### id

#### Get Signature

> **get** **id**(): `string`

##### Returns

`string`

***

### result

#### Get Signature

> **get** **result**(): `unknown`

##### Returns

`unknown`

***

### status

#### Get Signature

> **get** **status**(): [`ReviewItemStatus`](../../../../../generated/agent-harness/types.gen/type-aliases/ReviewItemStatus.md)

##### Returns

[`ReviewItemStatus`](../../../../../generated/agent-harness/types.gen/type-aliases/ReviewItemStatus.md)

## Methods

### dismiss()

> **dismiss**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### edit()

> **edit**(`draft`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `draft` | `unknown` |

#### Returns

`Promise`\<`void`\>

***

### submit()

> **submit**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
