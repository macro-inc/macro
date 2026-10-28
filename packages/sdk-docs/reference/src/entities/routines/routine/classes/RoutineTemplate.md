# Class: RoutineTemplate

A routine shared as a template, which people activate as their own routine.

## Constructors

### Constructor

> **new RoutineTemplate**(`routine`, `author`, `record`): `RoutineTemplate`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `routine` | [`Routine`](Routine.md) | The shared routine. |
| `author` | [`User`](../../../users/user/classes/User.md) | Who shared it. |
| `record` | [`RoutineTemplate`](../../../../../generated/scheduled-action/types.gen/type-aliases/RoutineTemplate.md) | Template snapshot. |

#### Returns

`RoutineTemplate`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-author"></a> `author` | `readonly` | [`User`](../../../users/user/classes/User.md) | Who shared it. |
| <a id="property-record"></a> `record` | `readonly` | [`RoutineTemplate`](../../../../../generated/scheduled-action/types.gen/type-aliases/RoutineTemplate.md) | Template snapshot. |
| <a id="property-routine"></a> `routine` | `readonly` | [`Routine`](Routine.md) | The shared routine. |

## Methods

### activate()

> **activate**(`options`): `Promise`\<[`Routine`](Routine.md)\>

Create the caller's own routine from this template, with its references
already filled in for them.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../interfaces/RoutineOptions.md) |

#### Returns

`Promise`\<[`Routine`](Routine.md)\>

***

### toJSON()

> **toJSON**(): [`RoutineTemplate`](../../../../../generated/scheduled-action/types.gen/type-aliases/RoutineTemplate.md)

Serialize without the authenticated client.

#### Returns

[`RoutineTemplate`](../../../../../generated/scheduled-action/types.gen/type-aliases/RoutineTemplate.md)
