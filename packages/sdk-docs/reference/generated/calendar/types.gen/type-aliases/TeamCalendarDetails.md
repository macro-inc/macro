# Type Alias: TeamCalendarDetails

> **TeamCalendarDetails** = \{ `attendees`: [`CalendarAttendee`](CalendarAttendee.md)[]; `calendarName`: `string`; `conferenceUrl?`: `string` \| `null`; `description?`: `string` \| `null`; `location?`: `string` \| `null`; `organizerEmail?`: `string` \| `null`; `organizerName?`: `string` \| `null`; `title`: `string`; \}

Safe details from a single authorized source.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees` | [`CalendarAttendee`](CalendarAttendee.md)[] | Attendees; self flags are relative to the requesting viewer. |
| <a id="property-calendarname"></a> `calendarName` | `string` | Source calendar name, shown only with details. |
| <a id="property-conferenceurl"></a> `conferenceUrl?` | `string` \| `null` | Join URL, if supplied by this source. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Body, if supplied by this source. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Location, if supplied by this source. |
| <a id="property-organizeremail"></a> `organizerEmail?` | `string` \| `null` | Organizer address from this source. |
| <a id="property-organizername"></a> `organizerName?` | `string` \| `null` | Organizer name from this source. |
| <a id="property-title"></a> `title` | `string` | Display title. |
