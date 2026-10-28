# Class: CalendarReplacement

Durable organizer replacement, recoverable even after the original event is retired.

## Constructors

### Constructor

> **new CalendarReplacement**(`client`, `id`): `CalendarReplacement`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`CalendarReplacement`

## Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` |

## Methods

### confirm()

> **confirm**(): `Promise`\<[`CalendarReplacementView`](../../../../../generated/calendar/types.gen/type-aliases/CalendarReplacementView.md)\>

Confirm the reviewed cancellation and reinvitation, or resume that same operation.
Present the preview and obtain the organizer's confirmation before the first call.

#### Returns

`Promise`\<[`CalendarReplacementView`](../../../../../generated/calendar/types.gen/type-aliases/CalendarReplacementView.md)\>

***

### discard()

> **discard**(): `Promise`\<`void`\>

Discard an unconfirmed preview. Confirmed operations must be recovered, not discarded.

#### Returns

`Promise`\<`void`\>

***

### status()

> **status**(): `Promise`\<[`CalendarReplacementView`](../../../../../generated/calendar/types.gen/type-aliases/CalendarReplacementView.md)\>

Read progress without initiating provider writes.

#### Returns

`Promise`\<[`CalendarReplacementView`](../../../../../generated/calendar/types.gen/type-aliases/CalendarReplacementView.md)\>
