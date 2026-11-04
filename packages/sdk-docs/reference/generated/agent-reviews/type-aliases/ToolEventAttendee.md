# Type Alias: ToolEventAttendee

> **ToolEventAttendee** = \{ `email`: `string`; `isOptional`: `boolean`; `isOrganizer`: `boolean`; `responseStatus`: `string`; \}

An attendee of a calendar event, as returned by calendar tools.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email` | `string` | Attendee email address. |
| <a id="property-isoptional"></a> `isOptional` | `boolean` | Whether attendance is optional. |
| <a id="property-isorganizer"></a> `isOrganizer` | `boolean` | Whether this attendee organized the event. |
| <a id="property-responsestatus"></a> `responseStatus` | `string` | RSVP state: needs_action, accepted, declined, or tentative. |
