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
