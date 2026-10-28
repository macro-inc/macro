# Class: EmailNamespace

## Constructors

### Constructor

> **new EmailNamespace**(`client`): `EmailNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`EmailNamespace`

## Methods

### attachment()

> **attachment**(`id`): [`EmailAttachment`](../../attachment/classes/EmailAttachment.md)

A handle to an email attachment by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`EmailAttachment`](../../attachment/classes/EmailAttachment.md)

***

### blockedSenders()

> **blockedSenders**(): `Promise`\<`string`[]\>

The email addresses currently blocked.

#### Returns

`Promise`\<`string`[]\>

***

### blockSender()

> **blockSender**(`email`): `Promise`\<`void`\>

Block an email sender.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `email` | `string` |

#### Returns

`Promise`\<`void`\>

***

### byId()

> **byId**(`id`): [`EmailThread`](../../thread/classes/EmailThread.md)

A handle to an email thread by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`EmailThread`](../../thread/classes/EmailThread.md)

***

### connectionProviders()

> **connectionProviders**(): `Promise`\<[`EmailConnectionProviders`](../../../../../generated/auth/types.gen/type-aliases/EmailConnectionProviders.md)\>

Providers the server currently permits this caller to connect.

#### Returns

`Promise`\<[`EmailConnectionProviders`](../../../../../generated/auth/types.gen/type-aliases/EmailConnectionProviders.md)\>

***

### contacts()

> **contacts**(): `Promise`\<\{\[`key`: `string`\]: [`ContactInfoWithInteraction`](../../../../../generated/email/types.gen/type-aliases/ContactInfoWithInteraction.md)[]; \}\>

Address book contacts grouped by the service's interaction buckets.

#### Returns

`Promise`\<\{\[`key`: `string`\]: [`ContactInfoWithInteraction`](../../../../../generated/email/types.gen/type-aliases/ContactInfoWithInteraction.md)[]; \}\>

***

### createDraft()

> **createDraft**(`options`, `inbox?`): `Promise`\<[`EmailDraft`](../../draft/classes/EmailDraft.md)\>

Create a draft without sending it; the inbox defaults to the caller's primary.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`DraftOptions`](../../draft/type-aliases/DraftOptions.md) |
| `inbox?` | [`Link`](../../link/classes/Link.md) |

#### Returns

`Promise`\<[`EmailDraft`](../../draft/classes/EmailDraft.md)\>

***

### createLabel()

> **createLabel**(`name`): `Promise`\<[`Label`](../../label/classes/Label.md)\>

Create a user label. Returns the created label.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<[`Label`](../../label/classes/Label.md)\>

***

### deleteLabel()

> **deleteLabel**(`label`): `Promise`\<`void`\>

Delete a label.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `label` | [`Label`](../../label/classes/Label.md) |

#### Returns

`Promise`\<`void`\>

***

### draftById()

> **draftById**(`id`): [`EmailDraft`](../../draft/classes/EmailDraft.md)

Construct a lazy draft handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`EmailDraft`](../../draft/classes/EmailDraft.md)

***

### filters()

> **filters**(`inbox?`): `Promise`\<[`EmailFilter`](../../filter/classes/EmailFilter.md)[]\>

Importance filters.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `inbox?` | [`Link`](../../link/classes/Link.md) |

#### Returns

`Promise`\<[`EmailFilter`](../../filter/classes/EmailFilter.md)[]\>

***

### inbox()

> **inbox**(`opts?`): `AsyncGenerator`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

The threads in the inbox, most recent first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | [`InboxOptions`](../interfaces/InboxOptions.md) |

#### Returns

`AsyncGenerator`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

***

### label()

> **label**(`id`): [`Label`](../../label/classes/Label.md)

A handle to a label by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Label`](../../label/classes/Label.md)

***

### labels()

> **labels**(): `Promise`\<[`Label`](../../label/classes/Label.md)[]\>

All labels across the user's inboxes.

#### Returns

`Promise`\<[`Label`](../../label/classes/Label.md)[]\>

***

### link()

> **link**(`id`): [`Link`](../../link/classes/Link.md)

A handle to a connected inbox (email link) by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Link`](../../link/classes/Link.md)

***

### links()

> **links**(): `Promise`\<[`Link`](../../link/classes/Link.md)[]\>

The caller's connected inboxes (email links).

#### Returns

`Promise`\<[`Link`](../../link/classes/Link.md)[]\>

***

### message()

> **message**(`id`): [`EmailMessage`](../../message/classes/EmailMessage.md)

A handle to an email message by id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`EmailMessage`](../../message/classes/EmailMessage.md)

***

### recoverDraftTransfer()

> **recoverDraftTransfer**(`operationId`): `Promise`\<[`TransferRecoveryResponse`](../../../../../generated/email/types.gen/type-aliases/TransferRecoveryResponse.md)\>

Recover a draft move using its original operation UUID; never starts a new move.
An empty committed result fences the old move so it cannot commit later.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `operationId` | `string` |

#### Returns

`Promise`\<[`TransferRecoveryResponse`](../../../../../generated/email/types.gen/type-aliases/TransferRecoveryResponse.md)\>

***

### reminders()

> **reminders**(`options?`): `AsyncGenerator`\<\{ `followup`: [`EmailFollowup`](../../../../../generated/storage/types.gen/type-aliases/EmailFollowup.md); `thread`: [`EmailThread`](../../thread/classes/EmailThread.md); \}, `any`, `any`\>

Follow-up reminders with thread handles, automatically paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | `Omit`\<\{ `attachments?`: `string`[] \| `null`; `calendar?`: `boolean` \| `null`; `cursor?`: `string` \| `null`; `done?`: `boolean` \| `null`; `inboxIds?`: `string`[] \| `null`; `limit?`: `number` \| `null`; `noInboxes?`: `boolean` \| `null`; `read?`: `boolean` \| `null`; `tags?`: `string`[] \| `null`; \}, `"cursor"` \| `"inboxIds"`\> & \{ `inboxes?`: [`Link`](../../link/classes/Link.md)[]; \} |

#### Returns

`AsyncGenerator`\<\{ `followup`: [`EmailFollowup`](../../../../../generated/storage/types.gen/type-aliases/EmailFollowup.md); `thread`: [`EmailThread`](../../thread/classes/EmailThread.md); \}, `any`, `any`\>

***

### scheduled()

> **scheduled**(`options?`): `AsyncGenerator`\<[`EmailDraft`](../../draft/classes/EmailDraft.md)\>

Scheduled drafts, fetched lazily in bounded pages.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `inbox?`: [`Link`](../../link/classes/Link.md); `pageSize?`: `number`; \} |
| `options.inbox?` | [`Link`](../../link/classes/Link.md) |
| `options.pageSize?` | `number` |

#### Returns

`AsyncGenerator`\<[`EmailDraft`](../../draft/classes/EmailDraft.md)\>

***

### search()

> **search**(`query`, `opts?`): `AsyncGenerator`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

Search email threads by subject and content.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `opts?` | [`SearchOpts`](../../../search/interfaces/SearchOpts.md) |

#### Returns

`AsyncGenerator`\<[`EmailThread`](../../thread/classes/EmailThread.md)\>

***

### send()

> **send**(`opts`): `Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md) \| `undefined`\>

Send a new email message.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`SendEmailOptions`](../../message/interfaces/SendEmailOptions.md) |

#### Returns

`Promise`\<[`EmailMessage`](../../message/classes/EmailMessage.md) \| `undefined`\>

***

### unblockSender()

> **unblockSender**(`email`): `Promise`\<`void`\>

Unblock a previously blocked sender.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `email` | `string` |

#### Returns

`Promise`\<`void`\>

***

### upsertFilter()

> **upsertFilter**(`options`, `inbox?`): `Promise`\<[`EmailFilter`](../../filter/classes/EmailFilter.md)\>

Create or replace a filter matching an address or domain.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`EmailFilterOptions`](../../filter/interfaces/EmailFilterOptions.md) |
| `inbox?` | [`Link`](../../link/classes/Link.md) |

#### Returns

`Promise`\<[`EmailFilter`](../../filter/classes/EmailFilter.md)\>
