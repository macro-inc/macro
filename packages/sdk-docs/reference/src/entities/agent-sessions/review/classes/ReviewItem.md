# Class: ReviewItem

An item handle scopes edits and decisions to its persisted review.

## Constructors

### Constructor

> **new ReviewItem**(`snapshot`, `actions`): `ReviewItem`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `snapshot` | [`ReviewItem`](../../../../../generated/agent-reviews/type-aliases/ReviewItem.md)\<[`SendEmail`](../../../../../generated/agent-reviews/type-aliases/SendEmail.md), [`SendEmailResponse`](../../../../../generated/agent-reviews/type-aliases/SendEmailResponse.md)\> \| [`ReviewItem`](../../../../../generated/agent-reviews/type-aliases/ReviewItem.md)\<[`CreateCalendarEvent_Serialize`](../../../../../generated/agent-reviews/type-aliases/CreateCalendarEvent_Serialize.md), [`ToolCalendarEvent`](../../../../../generated/agent-reviews/type-aliases/ToolCalendarEvent.md)\> \| [`ReviewItem`](../../../../../generated/agent-reviews/type-aliases/ReviewItem.md)\<[`ImportDraft`](../../../../../generated/agent-reviews/type-aliases/ImportDraft.md), [`NotionImportReport_Serialize`](../../../../../generated/agent-reviews/type-aliases/NotionImportReport_Serialize.md)\> |
| `actions` | \{ `dismiss`: () => `Promise`\<`void`\>; `edit`: (`draft`) => `Promise`\<`void`\>; `submit`: () => `Promise`\<`void`\>; \} |
| `actions.dismiss` | () => `Promise`\<`void`\> |
| `actions.edit` | (`draft`) => `Promise`\<`void`\> |
| `actions.submit` | () => `Promise`\<`void`\> |

#### Returns

`ReviewItem`

## Accessors

### draft

#### Get Signature

> **get** **draft**(): [`CreateCalendarEvent_Serialize`](../../../../../generated/agent-reviews/type-aliases/CreateCalendarEvent_Serialize.md) \| [`ImportDraft`](../../../../../generated/agent-reviews/type-aliases/ImportDraft.md) \| [`SendEmail`](../../../../../generated/agent-reviews/type-aliases/SendEmail.md)

##### Returns

[`CreateCalendarEvent_Serialize`](../../../../../generated/agent-reviews/type-aliases/CreateCalendarEvent_Serialize.md) \| [`ImportDraft`](../../../../../generated/agent-reviews/type-aliases/ImportDraft.md) \| [`SendEmail`](../../../../../generated/agent-reviews/type-aliases/SendEmail.md)

***

### id

#### Get Signature

> **get** **id**(): `string`

##### Returns

`string`

***

### result

#### Get Signature

> **get** **result**(): [`NotionImportReport_Serialize`](../../../../../generated/agent-reviews/type-aliases/NotionImportReport_Serialize.md) \| [`SendEmailResponse`](../../../../../generated/agent-reviews/type-aliases/SendEmailResponse.md) \| [`ToolCalendarEvent`](../../../../../generated/agent-reviews/type-aliases/ToolCalendarEvent.md) \| `null`

The action's confirmed response, `null` until it completes.

##### Returns

[`NotionImportReport_Serialize`](../../../../../generated/agent-reviews/type-aliases/NotionImportReport_Serialize.md) \| [`SendEmailResponse`](../../../../../generated/agent-reviews/type-aliases/SendEmailResponse.md) \| [`ToolCalendarEvent`](../../../../../generated/agent-reviews/type-aliases/ToolCalendarEvent.md) \| `null`

***

### status

#### Get Signature

> **get** **status**(): [`ItemStatus`](../../../../../generated/agent-reviews/type-aliases/ItemStatus.md)

##### Returns

[`ItemStatus`](../../../../../generated/agent-reviews/type-aliases/ItemStatus.md)

## Methods

### dismiss()

> **dismiss**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

***

### edit()

> **edit**(`draft`): `Promise`\<`void`\>

Replace this pending draft; `kind` must match the review's.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `draft` | [`ReviewDraft_Deserialize`](../../../../../generated/agent-reviews/type-aliases/ReviewDraft_Deserialize.md) |

#### Returns

`Promise`\<`void`\>

***

### submit()

> **submit**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
