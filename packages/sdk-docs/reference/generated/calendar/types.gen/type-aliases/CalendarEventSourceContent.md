# Type Alias: CalendarEventSourceContent

> **CalendarEventSourceContent** = \{ `calendarId`: `string`; `creatorEmail?`: `string` \| `null`; `creatorName?`: `string` \| `null`; `description?`: `string` \| `null`; `eventType`: [`EventType`](EventType.md); `isReadOnly`: `boolean`; `location?`: `string` \| `null`; `reminders`: [`EventReminders`](EventReminders.md); `title`: `string`; `transparency`: [`EventTransparency`](EventTransparency.md); `visibility`: [`EventVisibility`](EventVisibility.md); \}

The content one provider copy of an event carries.

Google keeps these fields per calendar copy: a shared calendar's copy of a
member's event can have its own title, type, reminders, and access role.
The entity holds its canonical source's values. Every other copy's values
are read from here so a client can show the copy that belongs to the
calendar being viewed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendarid"></a> `calendarId` | `string` | Calendar this copy lives on. |
| <a id="property-creatoremail"></a> `creatorEmail?` | `string` \| `null` | Provider-reported creator email. |
| <a id="property-creatorname"></a> `creatorName?` | `string` \| `null` | Provider-reported creator display name. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Optional event body. |
| <a id="property-eventtype"></a> `eventType` | [`EventType`](EventType.md) | Provider event type. |
| <a id="property-isreadonly"></a> `isReadOnly` | `boolean` | Whether the calendar's access role prohibits editing this copy. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Optional physical or virtual location label. |
| <a id="property-reminders"></a> `reminders` | [`EventReminders`](EventReminders.md) | Reminder configuration of this copy. |
| <a id="property-title"></a> `title` | `string` | Display title. |
| <a id="property-transparency"></a> `transparency` | [`EventTransparency`](EventTransparency.md) | Availability behavior. |
| <a id="property-visibility"></a> `visibility` | [`EventVisibility`](EventVisibility.md) | Event visibility. |
