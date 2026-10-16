# Class: BotsNamespace

The authenticated bot's identity. Only meaningful with bot auth
(`auth: { type: 'bot', token }`).

## Constructors

### Constructor

> **new BotsNamespace**(`client`): `BotsNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`BotsNamespace`

## Methods

### channels()

> **channels**(): `Promise`\<[`BotChannel`](../../../../../generated/storage/types.gen/type-aliases/BotChannel.md)[]\>

Channels containing the authenticated bot. Requires bot auth.

#### Returns

`Promise`\<[`BotChannel`](../../../../../generated/storage/types.gen/type-aliases/BotChannel.md)[]\>

***

### me()

> **me**(): `Promise`\<[`Bot`](../../../../../generated/storage/types.gen/type-aliases/Bot.md)\>

The authenticated bot's own record. Requires bot auth; with a user API
key this throws (a user token has no bot identity).

#### Returns

`Promise`\<[`Bot`](../../../../../generated/storage/types.gen/type-aliases/Bot.md)\>

***

### myPrincipalId()

> **myPrincipalId**(): `Promise`\<`string`\>

The authenticated bot's canonical principal id (`bot|<uuid>`) — the form
used for bot mentions, senders, and webhook `ids` filters. Cached on the
client; see MacroClient.myPrincipalId.

#### Returns

`Promise`\<`string`\>
