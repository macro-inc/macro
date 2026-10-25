# Class: RoutineNamespace

Scheduled and event-triggered routines.

## Constructors

### Constructor

> **new RoutineNamespace**(`client`): `RoutineNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`RoutineNamespace`

## Methods

### byId()

> **byId**(`id`): [`Routine`](../../routine/classes/Routine.md)

Construct a lazy routine handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Routine`](../../routine/classes/Routine.md)

***

### create()

> **create**(`options`): `Promise`\<[`Routine`](../../routine/classes/Routine.md)\>

Create an agent routine.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../../routine/interfaces/RoutineOptions.md) |

#### Returns

`Promise`\<[`Routine`](../../routine/classes/Routine.md)\>

***

### list()

> **list**(`options?`): `Promise`\<[`Routine`](../../routine/classes/Routine.md)[]\>

List routines, optionally including event triggers.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `includeEvents?`: `boolean`; \} |
| `options.includeEvents?` | `boolean` |

#### Returns

`Promise`\<[`Routine`](../../routine/classes/Routine.md)[]\>
