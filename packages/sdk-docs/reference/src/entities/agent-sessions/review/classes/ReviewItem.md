# Class: ReviewItem

An item handle scopes edits and decisions to its persisted review.

## Constructors

### Constructor

> **new ReviewItem**(`snapshot`, `actions`): `ReviewItem`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `snapshot` | `ReviewItem`\<`SendEmail`, `SendEmailResponse`\> \| `ReviewItem`\<`CreateCalendarEvent_Serialize`, `ToolCalendarEvent`\> \| `ReviewItem`\<`ImportDraft`, `NotionImportReport_Serialize`\> |
| `actions` | \{ `dismiss`: () => `Promise`\<`void`\>; `edit`: (`draft`) => `Promise`\<`void`\>; `submit`: () => `Promise`\<`void`\>; \} |
| `actions.dismiss` | () => `Promise`\<`void`\> |
| `actions.edit` | (`draft`) => `Promise`\<`void`\> |
| `actions.submit` | () => `Promise`\<`void`\> |

#### Returns

`ReviewItem`

## Accessors

### draft

#### Get Signature

> **get** **draft**(): `CreateCalendarEvent_Serialize` \| `ImportDraft` \| `SendEmail`

##### Returns

`CreateCalendarEvent_Serialize` \| `ImportDraft` \| `SendEmail`

***

### id

#### Get Signature

> **get** **id**(): `string`

##### Returns

`string`

***

### result

#### Get Signature

> **get** **result**(): `NotionImportReport_Serialize` \| `SendEmailResponse` \| `ToolCalendarEvent` \| `null`

The action's confirmed response, `null` until it completes.

##### Returns

`NotionImportReport_Serialize` \| `SendEmailResponse` \| `ToolCalendarEvent` \| `null`

***

### status

#### Get Signature

> **get** **status**(): `ItemStatus`

##### Returns

`ItemStatus`

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
| `draft` | `ReviewDraft_Deserialize` |

#### Returns

`Promise`\<`void`\>

***

### submit()

> **submit**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
