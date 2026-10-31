# Class: InitiativeNamespace

Initiatives in the caller's workspace; find one by name with one
`summaries()` call, not `name()` on each listed handle (one request each).

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

List accessible initiatives as handles; use `summaries()` for their names.

#### Returns

`Promise`\<[`Initiative`](../../initiative/classes/Initiative.md)[]\>

***

### summaries()

> **summaries**(): `Promise`\<[`InitiativeSummary`](../interfaces/InitiativeSummary.md)[]\>

Every accessible initiative with its name, in one request.

#### Returns

`Promise`\<[`InitiativeSummary`](../interfaces/InitiativeSummary.md)[]\>
