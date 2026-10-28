# Class: HarnessNamespace

Hosts and device pairing. Self operations require host credentials.

## Constructors

### Constructor

> **new HarnessNamespace**(`client`): `HarnessNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`HarnessNamespace`

## Methods

### agents()

> **agents**(): `Promise`\<[`Agent`](../../../agents/agent/classes/Agent.md)[]\>

Agent handles for the currently authenticated host.

#### Returns

`Promise`\<[`Agent`](../../../agents/agent/classes/Agent.md)[]\>

***

### byId()

> **byId**(`id`): [`Harness`](../../harness/classes/Harness.md)

Construct a lazy host handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Harness`](../../harness/classes/Harness.md)

***

### createPairing()

> **createPairing**(`options`): `Promise`\<\{ `device`: [`DevicePairing`](../../pairing/classes/DevicePairing.md); `deviceSecret`: `string`; `expiresAt`: `string`; `pairing`: [`HarnessPairing`](../../pairing/classes/HarnessPairing.md); `pollIntervalSeconds`: `number`; \}\>

Start pairing a device; persist the secret separately from the handles.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`CreatePairingRequest`](../../../../../generated/storage/types.gen/type-aliases/CreatePairingRequest.md) |

#### Returns

`Promise`\<\{ `device`: [`DevicePairing`](../../pairing/classes/DevicePairing.md); `deviceSecret`: `string`; `expiresAt`: `string`; `pairing`: [`HarnessPairing`](../../pairing/classes/HarnessPairing.md); `pollIntervalSeconds`: `number`; \}\>

***

### deleteSelf()

> **deleteSelf**(): `Promise`\<`void`\>

Revoke the currently authenticated host.

#### Returns

`Promise`\<`void`\>

***

### list()

> **list**(): `Promise`\<[`Harness`](../../harness/classes/Harness.md)[]\>

All hosts visible to the caller.

#### Returns

`Promise`\<[`Harness`](../../harness/classes/Harness.md)[]\>

***

### me()

> **me**(): `Promise`\<[`Harness`](../../harness/classes/Harness.md)\>

The currently authenticated host.

#### Returns

`Promise`\<[`Harness`](../../harness/classes/Harness.md)\>

***

### pairing()

> **pairing**(`code`): [`HarnessPairing`](../../pairing/classes/HarnessPairing.md)

Construct a lazy pairing from its displayed code.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | `string` |

#### Returns

[`HarnessPairing`](../../pairing/classes/HarnessPairing.md)

***

### sessions()

> **sessions**(): `Promise`\<[`AgentSession`](../../../agent-sessions/agent-session/classes/AgentSession.md)[]\>

Session handles for the currently authenticated host.

#### Returns

`Promise`\<[`AgentSession`](../../../agent-sessions/agent-session/classes/AgentSession.md)[]\>
