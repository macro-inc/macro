# Class: InitiativeNamespace

Initiatives in the caller's workspace.

## Constructors

### Constructor

> **new InitiativeNamespace**(`client`): `InitiativeNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`InitiativeNamespace`

## Methods

### byId()

> **byId**(`id`): [`Initiative`](../../initiative/classes/Initiative.md)

Construct a lazy initiative handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Initiative`](../../initiative/classes/Initiative.md)

***

### create()

> **create**(`options`): `Promise`\<[`Initiative`](../../initiative/classes/Initiative.md)\>

Create an initiative.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`InitiativeOptions`](../../initiative/interfaces/InitiativeOptions.md) |

#### Returns

`Promise`\<[`Initiative`](../../initiative/classes/Initiative.md)\>

***

### list()

> **list**(): `Promise`\<[`Initiative`](../../initiative/classes/Initiative.md)[]\>

List accessible initiatives.

#### Returns

`Promise`\<[`Initiative`](../../initiative/classes/Initiative.md)[]\>
