# Type Alias: CalendarEventOrganizer

> **CalendarEventOrganizer** = \{ `email?`: `string` \| `null`; `name?`: `string` \| `null`; \}

The event's organizer — its creator, in Google's model. Either field can be
absent when the source does not name it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email?` | `string` \| `null` | Organizer email address, when known. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name, when the source provided one. |
