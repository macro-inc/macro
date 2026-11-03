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

Create an agent routine. To check on something later, such as a spawned
session or a long job, create a routine instead of waiting in a program.
Set `model`, `agent`, or both. A cron `schedule` has 6 fields (second
minute hour day-of-month month day-of-week) or 7 with a year; a 7-field
schedule that names one date runs once. A rejected routine throws a
`MacroApiError` whose message says what the server refused.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../../routine/interfaces/RoutineOptions.md) |

#### Returns

`Promise`\<[`Routine`](../../routine/classes/Routine.md)\>

#### Example

```ts
// Every ten minutes, in New York time.
const routine = await macro.routines.create({
  name: 'Check the import',
  prompt: 'Read the import task and post its status in the channel.',
  userPrompt: 'Check on the import every ten minutes.',
  model: 'anthropic/claude-sonnet-5-5',
  trigger: {
    type: 'cron',
    schedule: '0 0/10 * * * *',
    timezone: 'America/New_York',
  },
});
// Once, at 14:30 on 3 November 2027.
await macro.routines.create({
  name: 'Follow up on the review',
  prompt: 'Read the review session and summarize its outcome.',
  userPrompt: 'Follow up on the review on 3 November 2027.',
  model: 'anthropic/claude-sonnet-5-5',
  trigger: { type: 'cron', schedule: '0 30 14 3 11 * 2027', timezone: 'UTC' },
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
