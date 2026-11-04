# Class: SessionReview

A persistent review remains actionable after the code execution ends.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<`ReviewRecord`\>

## Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `public readonly` | `string` | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<`"calendar"` \| `"email"` \| `"import"`\> | - |
| <a id="property-title"></a> `title` | `readonly` | () => `Promise`\<`string`\> | - |

## Methods

### dismissAll()

> **dismissAll**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### items()

> **items**(): `Promise`\<[`ReviewItem`](ReviewItem.md)[]\>

#### Returns

`Promise`\<[`ReviewItem`](ReviewItem.md)[]\>

***

### reference()

> **reference**(): `Promise`\<\{ `id`: `string`; `kind`: `"calendar"` \| `"email"` \| `"import"`; \}\>

Compact reference for main()'s returned reviews array.

#### Returns

`Promise`\<\{ `id`: `string`; `kind`: `"calendar"` \| `"email"` \| `"import"`; \}\>

***

### refresh()

> **refresh**(): `Promise`\<`SessionReview`\>

#### Returns

`Promise`\<`SessionReview`\>

***

### session()

> **session**(): [`AgentSession`](../../agent-session/classes/AgentSession.md)

#### Returns

[`AgentSession`](../../agent-session/classes/AgentSession.md)

***

### submitAll()

> **submitAll**(): `Promise`\<`void`\>

Submit the saved pending drafts. Never retries a conflict or ambiguous send.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ReviewRecord_Serialize`](../../../../../generated/agent-reviews/type-aliases/ReviewRecord_Serialize.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ReviewRecord_Serialize`](../../../../../generated/agent-reviews/type-aliases/ReviewRecord_Serialize.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ReviewRecord_Serialize`](../../../../../generated/agent-reviews/type-aliases/ReviewRecord_Serialize.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `session`, `id`): `SessionReview`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `session` | [`AgentSession`](../../agent-session/classes/AgentSession.md) |
| `id` | `string` |

#### Returns

`SessionReview`

***

### create()

> `static` **create**(`client`, `execution`, `input`): `Promise`\<`SessionReview`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `execution` | [`CodeExecution`](../../code-execution/classes/CodeExecution.md) |
| `input` | [`CreateReviewOptions`](../type-aliases/CreateReviewOptions.md) |

#### Returns

`Promise`\<`SessionReview`\>

***

### createForSession()

> `static` **createForSession**(`client`, `session`, `input`, `execution?`): `Promise`\<`SessionReview`\>

Present a review in a session without requiring a code execution.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `session` | [`AgentSession`](../../agent-session/classes/AgentSession.md) |
| `input` | [`CreateReviewOptions`](../type-aliases/CreateReviewOptions.md) |
| `execution?` | [`CodeExecution`](../../code-execution/classes/CodeExecution.md) |

#### Returns

`Promise`\<`SessionReview`\>

***

### fromRecord()

> `static` **fromRecord**(`client`, `session`, `record`): `SessionReview`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `session` | [`AgentSession`](../../agent-session/classes/AgentSession.md) |
| `record` | [`ReviewRecord_Serialize`](../../../../../generated/agent-reviews/type-aliases/ReviewRecord_Serialize.md) |

#### Returns

`SessionReview`

***

### list()

> `static` **list**(`client`, `execution`): `Promise`\<`SessionReview`[]\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `execution` | [`CodeExecution`](../../code-execution/classes/CodeExecution.md) |

#### Returns

`Promise`\<`SessionReview`[]\>
