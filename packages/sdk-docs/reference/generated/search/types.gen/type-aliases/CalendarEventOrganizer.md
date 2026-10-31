# Type Alias: CalendarEventOrganizer

> **CalendarEventOrganizer** = \{ `email?`: `string` \| `null`; `name?`: `string` \| `null`; \}

The organizer the provider names on the event. Either field can be absent
when the source does not name it. On a read-only Outlook calendar, such as
its holidays, Microsoft names the mailbox owner on every event, so this
does not say the user organized anything: `role` does.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email?` | `string` \| `null` | Organizer email address, when known. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name, when the source provided one. |
