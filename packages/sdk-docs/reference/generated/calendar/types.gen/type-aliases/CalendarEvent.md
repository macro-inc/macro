# Type Alias: CalendarEvent

> **CalendarEvent** = \{ `attendees`: [`CalendarAttendee`](CalendarAttendee.md)[]; `calendarId?`: `string` \| `null`; `conferenceProvider?`: `null` \| [`ConferenceProvider`](ConferenceProvider.md); `conferenceUrl?`: `string` \| `null`; `createdAt`: `string`; `creatorEmail?`: `string` \| `null`; `creatorName?`: `string` \| `null`; `description?`: `string` \| `null`; `eventType?`: [`EventType`](EventType.md); `guestPolicy`: [`GuestPolicy`](GuestPolicy.md); `icalUid`: `string`; `id`: `string`; `isReadOnly`: `boolean`; `isSnapshot`: `boolean`; `location?`: `string` \| `null`; `organizerEmail?`: `string` \| `null`; `organizerName?`: `string` \| `null`; `ownerId`: `string`; `recurrenceLines`: `string`[]; `reminders?`: [`EventReminders`](EventReminders.md); `sequence`: `number`; `sources?`: [`CalendarEventSourceContent`](CalendarEventSourceContent.md)[]; `status`: [`EventStatus`](EventStatus.md); `time`: [`EventTime`](EventTime.md); `title`: `string`; `transparency`: [`EventTransparency`](EventTransparency.md); `updatedAt`: `string`; `viewerCan`: [`ViewerCapabilities`](ViewerCapabilities.md); `visibility`: [`EventVisibility`](EventVisibility.md); \}

A stable, first-class Macro calendar event entity.

Content fields hold the canonical source's values: the account's primary
calendar copy when one is synced, else the freshest remaining copy.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees` | [`CalendarAttendee`](CalendarAttendee.md)[] | Attendees, keyed by email during persistence. |
| <a id="property-calendarid"></a> `calendarId?` | `string` \| `null` | Calendar the canonical source belongs to, when known. Absent only in projections stored before calendars were attributed. |
| <a id="property-conferenceprovider"></a> `conferenceProvider?` | `null` \| [`ConferenceProvider`](ConferenceProvider.md) | - |
| <a id="property-conferenceurl"></a> `conferenceUrl?` | `string` \| `null` | Direct join URL when known. |
| <a id="property-createdat"></a> `createdAt` | `string` | Entity creation time. |
| <a id="property-creatoremail"></a> `creatorEmail?` | `string` \| `null` | Provider-reported creator email. Distinct from the organizer when someone writes onto a calendar they do not own. Omitted from stored projections when unknown so events ingested before this field still compare equal. |
| <a id="property-creatorname"></a> `creatorName?` | `string` \| `null` | Provider-reported creator display name. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Optional event body. |
| <a id="property-eventtype"></a> `eventType?` | [`EventType`](EventType.md) | Provider event type. Skipped when it is the regular type so projections stored before event types were modeled still compare equal. |
| <a id="property-guestpolicy"></a> `guestPolicy` | [`GuestPolicy`](GuestPolicy.md) | What the organizer lets guests do: the canonical copy's values, or Google's defaults for an event synced before the policy was modeled. |
| <a id="property-icaluid"></a> `icalUid` | `string` | RFC 5545 UID used to reconcile provider and email sources. |
| <a id="property-id"></a> `id` | `string` | Macro entity identifier. |
| <a id="property-isreadonly"></a> `isReadOnly` | `boolean` | Whether the canonical source's calendar prohibits editing it. |
| <a id="property-issnapshot"></a> `isSnapshot` | `boolean` | Whether this is a snapshot of a meeting shared with the owner, which Macro added to their calendar as a private copy: the meeting's changes never reach it, and nothing done to it reaches the meeting. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Optional physical or virtual location label. |
| <a id="property-organizeremail"></a> `organizerEmail?` | `string` \| `null` | Organizer email. |
| <a id="property-organizername"></a> `organizerName?` | `string` \| `null` | Organizer display name. |
| <a id="property-ownerid"></a> `ownerId` | `string` | Macro user who owns this event entity. |
| <a id="property-recurrencelines"></a> `recurrenceLines` | `string`[] | Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). |
| <a id="property-reminders"></a> `reminders?` | [`EventReminders`](EventReminders.md) | Per-user reminder configuration. Skipped when it is the provider default so projections stored before reminders were modeled still compare equal. |
| <a id="property-sequence"></a> `sequence` | `number` | Provider/iCalendar sequence number. |
| <a id="property-sources"></a> `sources?` | [`CalendarEventSourceContent`](CalendarEventSourceContent.md)[] | Content of every active copy of this event, canonical first: the primary calendar's copy, then the freshest. A client picks the copy whose calendar it is showing and falls back to the first. Populated only on the read path, so stored projections omit it. |
| <a id="property-status"></a> `status` | [`EventStatus`](EventStatus.md) | Event status. |
| <a id="property-time"></a> `time` | [`EventTime`](EventTime.md) | Timed or all-day shape. |
| <a id="property-title"></a> `title` | `string` | Display title. |
| <a id="property-transparency"></a> `transparency` | [`EventTransparency`](EventTransparency.md) | Availability behavior. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Entity update time. |
| <a id="property-viewercan"></a> `viewerCan` | [`ViewerCapabilities`](ViewerCapabilities.md) | What the viewing requester may do with the event. Resolved only on the read path, alongside each attendee's `is_self`; nothing when no viewer is known. Source projections never store it. |
| <a id="property-visibility"></a> `visibility` | [`EventVisibility`](EventVisibility.md) | Event visibility. |
