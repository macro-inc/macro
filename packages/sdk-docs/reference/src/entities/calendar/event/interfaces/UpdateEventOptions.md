# Interface: UpdateEventOptions

Fields to change on an event; omitted fields are left untouched.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees?` | [`CalendarAttendeeInputBody`](../../../../../generated/calendar/types.gen/type-aliases/CalendarAttendeeInputBody.md)[] | Replacement attendee list. |
| <a id="property-calendar"></a> `calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) | Calendar whose copy of the event is patched, for a multi-calendar event. Omit to patch the canonical copy. |
| <a id="property-conference"></a> `conference?` | [`ConferenceChange`](../../../../../generated/calendar/types.gen/type-aliases/ConferenceChange.md) | Provider conference change; omit to retain it. Outlook removal requires a separately confirmed replacement via prepareReplacement(). |
| <a id="property-description"></a> `description?` | `string` | Replacement description; an empty string clears it. |
| <a id="property-location"></a> `location?` | `string` | Replacement location; an empty string clears it. |
| <a id="property-outofoffice"></a> `outOfOffice?` | [`OutOfOfficeProperties`](../../../../../generated/calendar/types.gen/type-aliases/OutOfOfficeProperties.md) | Replacement out-of-office properties, applied only to an event that is already out-of-office. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` | Original-start key of the occurrence the update targets. |
| <a id="property-recurrencelines"></a> `recurrenceLines?` | `string`[] | Replacement recurrence properties; an empty list clears them. |
| <a id="property-reminders"></a> `reminders?` | [`EventReminders`](../../../../../generated/calendar/types.gen/type-aliases/EventReminders.md) | Replacement reminder configuration. |
| <a id="property-scope"></a> `scope?` | [`CalendarUpdateScopeParam`](../../../../../generated/calendar/types.gen/type-aliases/CalendarUpdateScopeParam.md) | How much of a recurring series the update covers. Omit to let `recurrenceId` decide. |
| <a id="property-time"></a> `time?` | [`EventTime`](../../../../../generated/calendar/types.gen/type-aliases/EventTime.md) | Replacement time. |
| <a id="property-title"></a> `title?` | `string` | Replacement title; an empty string clears it. |
| <a id="property-transparency"></a> `transparency?` | [`EventTransparency`](../../../../../generated/calendar/types.gen/type-aliases/EventTransparency.md) | Replacement availability behavior. |
| <a id="property-visibility"></a> `visibility?` | [`EventVisibility`](../../../../../generated/calendar/types.gen/type-aliases/EventVisibility.md) | Replacement visibility. |
