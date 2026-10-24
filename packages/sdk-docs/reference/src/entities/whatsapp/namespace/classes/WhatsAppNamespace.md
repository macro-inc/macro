# Class: WhatsAppNamespace

Operate on an account already paired through the Macro app.

## Constructors

### Constructor

> **new WhatsAppNamespace**(`client`): `WhatsAppNamespace`

Bind existing-account operations to this authenticated client.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`WhatsAppNamespace`

## Methods

### account()

> **account**(): `Promise`\<[`WhatsAppAccount`](../../account/classes/WhatsAppAccount.md) \| `undefined`\>

Current owner's account, or undefined when no account has been connected.

#### Returns

`Promise`\<[`WhatsAppAccount`](../../account/classes/WhatsAppAccount.md) \| `undefined`\>

***

### byId()

> **byId**(`id`): [`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)

Reference an adopted entity without fetching it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)

***

### groups()

> **groups**(): `Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)[]\>

Adopted groups shared with the caller, including without WhatsApp.

#### Returns

`Promise`\<[`WhatsAppGroup`](../../group/classes/WhatsAppGroup.md)[]\>

***

### remoteGroups()

> **remoteGroups**(): `Promise`\<[`WhatsAppRemoteGroup`](../../remote-group/classes/WhatsAppRemoteGroup.md)[]\>

Groups discoverable through the caller's own connected account.

#### Returns

`Promise`\<[`WhatsAppRemoteGroup`](../../remote-group/classes/WhatsAppRemoteGroup.md)[]\>
