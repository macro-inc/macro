# Type Alias: CalendarCapabilities

> **CalendarCapabilities** = \{ `autoDecline`: `boolean`; `conferenceProvider?`: `null` \| [`ConferenceProvider`](ConferenceProvider.md); `customRecurrence`: `boolean`; `emailReminders`: `boolean`; `guestPolicy`: `boolean`; `removeConference`: `boolean`; `resetRsvp`: `boolean`; \}

Actual provider capabilities used by calendar editors.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-autodecline"></a> `autoDecline` | `boolean` | Whether event-level automatic invitation declines are supported. |
| <a id="property-conferenceprovider"></a> `conferenceProvider?` | `null` \| [`ConferenceProvider`](ConferenceProvider.md) | - |
| <a id="property-customrecurrence"></a> `customRecurrence` | `boolean` | Whether arbitrary RFC 5545 recurrence properties can be written. |
| <a id="property-emailreminders"></a> `emailReminders` | `boolean` | Whether email reminders are delivered by the provider or Macro. |
| <a id="property-guestpolicy"></a> `guestPolicy` | `boolean` | Whether the organizer can set what guests may do. |
| <a id="property-removeconference"></a> `removeConference` | `boolean` | Whether an existing conference can be detached. |
| <a id="property-resetrsvp"></a> `resetRsvp` | `boolean` | Whether an attendee can reset their RSVP to unanswered. |
