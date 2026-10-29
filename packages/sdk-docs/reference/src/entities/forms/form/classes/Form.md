# Class: Form

A form over a database table. Viewers can read its questions and submit;
editors can build it and read responses; owners control its audience.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`FormDetail`](../../../../../generated/storage/types.gen/type-aliases/FormDetail.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-access"></a> `access` | `readonly` | () => `Promise`\<[`FormAccess`](../../../../../generated/storage/types.gen/type-aliases/FormAccess.md)\> | The caller's access level. | - |
| <a id="property-audience"></a> `audience` | `readonly` | () => `Promise`\<[`Audience`](../../../../../generated/storage/types.gen/type-aliases/Audience.md)\> | Who may respond. | - |
| <a id="property-closesat"></a> `closesAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Scheduled closing time, when set. | - |
| <a id="property-database"></a> `database` | `readonly` | () => `Promise`\<[`Database`](../../../databases/database/classes/Database.md)\> | The response database. Reading its contents requires separate access. | - |
| <a id="property-description"></a> `description` | `readonly` | () => `Promise`\<`string`\> | Introductory text shown to respondents. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The form's display name. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The owning user. | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`FormStatus`](../../../../../generated/storage/types.gen/type-aliases/FormStatus.md)\> | Whether submissions are currently enabled. A closing time can also close the form. | - |
| <a id="property-table"></a> `table` | `readonly` | () => `Promise`\<[`DatabaseTable`](../../../databases/table/classes/DatabaseTable.md)\> | The linked table, without fetching its contents. | - |

## Methods

### editResponse()

> **editResponse**(`answers`): `Promise`\<[`FormSubmissionOutcome`](../type-aliases/FormSubmissionOutcome.md)\>

Replace the caller's answers while the form is open; gates are evaluated again.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `answers` | [`FormAnswer`](../type-aliases/FormAnswer.md)[] |

#### Returns

`Promise`\<[`FormSubmissionOutcome`](../type-aliases/FormSubmissionOutcome.md)\>

***

### myResponse()

> **myResponse**(): `Promise`\<[`MyFormResponse`](../type-aliases/MyFormResponse.md)\>

Read the caller's receipt and answers without reading anyone else's responses.

#### Returns

`Promise`\<[`MyFormResponse`](../type-aliases/MyFormResponse.md)\>

***

### questions()

> **questions**(): `Promise`\<[`FormQuestion`](../../question/classes/FormQuestion.md)[]\>

All questions in display order, skipping gates.

#### Returns

`Promise`\<[`FormQuestion`](../../question/classes/FormQuestion.md)[]\>

***

### replaceLayout()

> **replaceLayout**(`sections`): `Promise`\<[`FormLayoutResult`](../type-aliases/FormLayoutResult.md)\>

Save a replacement in the shared draft. Existing handles retain identity;
omitted handles mint sections or questions. Column facts use the database API.
A publicationError means the draft was saved but respondents still see the last
valid version. Repair the reported problem or reload to retry publication.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sections` | [`FormSectionPlacement`](../type-aliases/FormSectionPlacement.md)[] |

#### Returns

`Promise`\<[`FormLayoutResult`](../type-aliases/FormLayoutResult.md)\>

***

### respondUrl()

> **respondUrl**(): `string`

The respondent page, which public forms also expose without signing in.

#### Returns

`string`

***

### responseSummary()

> **responseSummary**(): `Promise`\<[`FormResponseSummary`](../type-aliases/FormResponseSummary.md)\>

Ledger counts and total table rows; requires edit access.

#### Returns

`Promise`\<[`FormResponseSummary`](../type-aliases/FormResponseSummary.md)\>

***

### schema()

> **schema**(): `Promise`\<[`FormDetail`](../../../../../generated/storage/types.gen/type-aliases/FormDetail.md)\>

The form's presentation and column facts; this never contains response rows.

#### Returns

`Promise`\<[`FormDetail`](../../../../../generated/storage/types.gen/type-aliases/FormDetail.md)\>

***

### sections()

> **sections**(): `Promise`\<[`FormSection`](../../section/classes/FormSection.md)[]\>

Sections in display order.

#### Returns

`Promise`\<[`FormSection`](../../section/classes/FormSection.md)[]\>

***

### sharePermissions()

> **sharePermissions**(): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Read the form's sharing grants. Requires ownership.

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### submit()

> **submit**(`answers`): `Promise`\<[`FormSubmissionOutcome`](../type-aliases/FormSubmissionOutcome.md)\>

Submit answers. Signed-in respondents get at most one response; use editResponse afterwards.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `answers` | [`FormAnswer`](../type-aliases/FormAnswer.md)[] |

#### Returns

`Promise`\<[`FormSubmissionOutcome`](../type-aliases/FormSubmissionOutcome.md)\>

***

### tally()

> **tally**(): `Promise`\<[`FormQuestionTally`](../type-aliases/FormQuestionTally.md)[]\>

Choice and checkbox counts, available to viewers when tally visibility is enabled.

#### Returns

`Promise`\<[`FormQuestionTally`](../type-aliases/FormQuestionTally.md)[]\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`FormDetail`](../../../../../generated/storage/types.gen/type-aliases/FormDetail.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`FormDetail`](../../../../../generated/storage/types.gen/type-aliases/FormDetail.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`FormDetail`](../../../../../generated/storage/types.gen/type-aliases/FormDetail.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`updates`): `Promise`\<`Form`\>

Update presentation or owner-controlled settings; null explicitly clears the closing time.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `updates` | [`UpdateForm`](../../../../../generated/storage/types.gen/type-aliases/UpdateForm.md) |

#### Returns

`Promise`\<`Form`\>

***

### updateSharePermissions()

> **updateSharePermissions**(`request`): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Update grants. Public responding is controlled by audience, not link sharing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`UpdateSharePermissionRequestV2`](../../../../../generated/storage/types.gen/type-aliases/UpdateSharePermissionRequestV2.md) |

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### webUrl()

> **webUrl**(): `string`

Open the form's builder in Macro.

#### Returns

`string`

***

### byId()

> `static` **byId**(`client`, `id`): `Form`

A form handle with details loaded on demand.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Form`

***

### create()

> `static` **create**(`client`, `options`): `Promise`\<`Form`\>

Create a form, optionally over a table of a database the caller owns.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `options` | \{ `name`: `string`; `table?`: [`DatabaseTable`](../../../databases/table/classes/DatabaseTable.md); \} |
| `options.name` | `string` |
| `options.table?` | [`DatabaseTable`](../../../databases/table/classes/DatabaseTable.md) |

#### Returns

`Promise`\<`Form`\>

***

### list()

> `static` **list**(`client`, `database?`): `Promise`\<`Form`[]\>

Forms shared with the caller, or live forms over a specified database.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `database?` | [`Database`](../../../databases/database/classes/Database.md) |

#### Returns

`Promise`\<`Form`[]\>
