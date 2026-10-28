# Class: Link

An email link: a connected inbox (e.g. Gmail or Outlook) that threads and
messages sync through. A free-to-construct handle, resolved from the
caller's connected links.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Link`](../../../../../generated/email/types.gen/type-aliases/Link.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-emailaddress"></a> `emailAddress` | `readonly` | () => `Promise`\<`string`\> | The inbox's email address. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-isprimary"></a> `isPrimary` | `readonly` | () => `Promise`\<`boolean`\> | Whether this is the user's primary inbox. | - |
| <a id="property-issyncactive"></a> `isSyncActive` | `readonly` | () => `Promise`\<`boolean`\> | Whether syncing is currently active for this inbox. | - |
| <a id="property-needsreauth"></a> `needsReauth` | `readonly` | () => `Promise`\<`boolean`\> | Whether the inbox needs to be re-authenticated. | - |
| <a id="property-photourl"></a> `photoUrl` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The inbox's avatar URL, if any. | - |
| <a id="property-provider"></a> `provider` | `readonly` | () => `Promise`\<[`UserProvider`](../../../../../generated/email/types.gen/type-aliases/UserProvider.md)\> | The email provider (e.g. `GMAIL` or `OUTLOOK`). | - |
| <a id="property-syncstatus"></a> `syncStatus` | `readonly` | () => `Promise`\<[`SyncStatus`](../../../../../generated/email/types.gen/type-aliases/SyncStatus.md)\> | The inbox's sync status. | - |

## Methods

### settingsOperations()

> **settingsOperations**(): `Promise`\<[`MailboxSettingsOperation`](../../../../../generated/email/types.gen/type-aliases/MailboxSettingsOperation.md)[]\>

Read category and sender-policy changes for this inbox.

#### Returns

`Promise`\<[`MailboxSettingsOperation`](../../../../../generated/email/types.gen/type-aliases/MailboxSettingsOperation.md)[]\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Link`](../../../../../generated/email/types.gen/type-aliases/Link.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Link`](../../../../../generated/email/types.gen/type-aliases/Link.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Link`](../../../../../generated/email/types.gen/type-aliases/Link.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `Link`

A handle to an email link by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Link`

***

### list()

> `static` **list**(`client`): `Promise`\<`Link`[]\>

The caller's connected email links.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`Link`[]\>
