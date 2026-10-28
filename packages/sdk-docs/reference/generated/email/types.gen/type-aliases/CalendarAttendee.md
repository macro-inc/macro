# Type Alias: CalendarAttendee

> **CalendarAttendee** = \{ `comment?`: `string` \| `null`; `displayName?`: `string` \| `null`; `email`: `string`; `isOptional`: `boolean`; `isOrganizer`: `boolean`; `isSelf`: `boolean`; `responseStatus`: [`AttendeeResponseStatus`](AttendeeResponseStatus.md); \}

An attendee on a calendar event.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-comment"></a> `comment?` | `string` \| `null` | Optional attendee comment. |
| <a id="property-displayname"></a> `displayName?` | `string` \| `null` | Provider display name. |
| <a id="property-email"></a> `email` | `string` | Normalized email address. |
| <a id="property-isoptional"></a> `isOptional` | `boolean` | Whether attendance is optional. |
| <a id="property-isorganizer"></a> `isOrganizer` | `boolean` | Whether this attendee is the organizer. |
| <a id="property-isself"></a> `isSelf` | `boolean` | Whether this attendee is one of the viewing requester's inboxes. |
| <a id="property-responsestatus"></a> `responseStatus` | [`AttendeeResponseStatus`](AttendeeResponseStatus.md) | RSVP state. |
