# Interface: RsvpEventOptions

The RSVP to record and how it is scoped across a recurring series.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendar"></a> `calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) | Calendar whose copy of the event is answered, for a multi-calendar event. Omit to answer on the canonical copy. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` | Original-start key of the occurrence the response targets. |
| <a id="property-response"></a> `response` | [`AttendeeResponseStatus`](../../../../../generated/calendar/types.gen/type-aliases/AttendeeResponseStatus.md) | The response to record for the connected account. |
| <a id="property-scope"></a> `scope?` | [`CalendarRsvpScopeParam`](../../../../../generated/calendar/types.gen/type-aliases/CalendarRsvpScopeParam.md) | How much of a recurring series the response covers. Omit to let `recurrenceId` decide. |
