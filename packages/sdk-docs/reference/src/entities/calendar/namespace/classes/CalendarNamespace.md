# Class: CalendarNamespace

The calendar surface: the caller's visible calendars, event creation, and
handles to individual events and calendars. Backed by calendar_service (the
SDK reaches it on the gateway's `/calendar` route).

## Constructors

### Constructor

> **new CalendarNamespace**(`client`): `CalendarNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`CalendarNamespace`

## Methods

### calendar()

> **calendar**(`id`): [`Calendar`](../../calendar/classes/Calendar.md)

A handle to a calendar by id. Detail loads on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Calendar`](../../calendar/classes/Calendar.md)

***

### calendars()

> **calendars**(): `Promise`\<[`Calendar`](../../calendar/classes/Calendar.md)[]\>

The caller's visible calendars, primaries and writable first.

#### Returns

`Promise`\<[`Calendar`](../../calendar/classes/Calendar.md)[]\>

***

### createEvent()

> **createEvent**(`options`): `Promise`\<[`CalendarEvent`](../../event/classes/CalendarEvent.md)\>

Create a calendar event and return a handle to its synced record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`CreateEventOptions`](../interfaces/CreateEventOptions.md) |

#### Returns

`Promise`\<[`CalendarEvent`](../../event/classes/CalendarEvent.md)\>

***

### event()

> **event**(`id`): [`CalendarEvent`](../../event/classes/CalendarEvent.md)

A handle to a calendar event by id, for driving mutations.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`CalendarEvent`](../../event/classes/CalendarEvent.md)
