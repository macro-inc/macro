# Type Alias: CalendarEventReminderMetadata

> **CalendarEventReminderMetadata** = \{ `endsAt?`: `string` \| `null`; `eventId`: `string`; `minutesBefore`: `number`; `occurrenceKey`: `string`; `startDate?`: `string` \| `null`; `startsAt?`: `string` \| `null`; `timeZone?`: `string` \| `null`; `title`: `string`; \}

A calendar event alarm came due. Like [`ReminderMetadata`], these are
self-notifications: `sender_id` must stay `None` or the only recipient is
filtered out. Everything the alert renders rides in here so the
dispatcher never has to resolve the event again at display time.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-endsat"></a> `endsAt?` | `string` \| `null` | Instance end, for timed events. |
| <a id="property-eventid"></a> `eventId` | `string` | The calendar event entity the alarm belongs to. |
| <a id="property-minutesbefore"></a> `minutesBefore` | `number` | Minutes before the start the alarm was configured to fire. |
| <a id="property-occurrencekey"></a> `occurrenceKey` | `string` | Stable occurrence key of the instance that is starting. |
| <a id="property-startdate"></a> `startDate?` | `string` \| `null` | Instance start date, for all-day events. |
| <a id="property-startsat"></a> `startsAt?` | `string` \| `null` | Instance start, for timed events. |
| <a id="property-timezone"></a> `timeZone?` | `string` \| `null` | IANA zone for rendering local clock times, when known. |
| <a id="property-title"></a> `title` | `string` | Event display title at dispatch time. |
