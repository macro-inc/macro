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

Create an agent routine: pass `model` or `agent`, and a five- or six-field
cron `schedule` with an IANA `timezone`.

Five-field crontab (`min hour day month weekday`, e.g. `0 9 * * *`) and
six-field (`sec min hour day month weekday`) are accepted. `agent` is
optional when `model` is set. Use cron for recurring checks; a run-once
trigger is not available here yet.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../../routine/type-aliases/RoutineOptions.md) |

#### Returns

`Promise`\<[`Routine`](../../routine/classes/Routine.md)\>

#### Example

```ts
const routine = await macro.routines.create({
  name: 'Recurring check',
  prompt: 'See whether the investigation finished and comment on the task.',
  userPrompt: 'Follow up on the investigation.',
  model: 'claude-sonnet-4-6',
  trigger: {
    type: 'cron',
    schedule: '0 9 * * *',
    timezone: 'America/New_York',
  },
});
```

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
