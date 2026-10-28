# Type Alias: SoupCalendarEventSoupPropertiesField

> **SoupCalendarEventSoupPropertiesField** = \{ `conferenceProvider?`: `string` \| `null`; `conferenceUrl?`: `string` \| `null`; `createdAt`: `string`; `description?`: `string` \| `null`; `extra`: \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \}; `icalUid`: `string`; `id`: `string`; `isReadOnly`: `boolean`; `lastReminderFiredAt?`: `string` \| `null`; `location?`: `string` \| `null`; `organizerEmail?`: `string` \| `null`; `organizerName?`: `string` \| `null`; `ownerId`: `string`; `status`: `string`; `time`: [`SoupCalendarEventTime`](SoupCalendarEventTime.md); `title`: `string`; `transparency`: `string`; `updatedAt`: `string`; `visibility`: `string`; \}

A canonical calendar event entity in Soup.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-conferenceprovider"></a> `conferenceProvider?` | `string` \| `null` | Which conferencing system backs `conference_url`. |
| <a id="property-conferenceurl"></a> `conferenceUrl?` | `string` \| `null` | Direct conference join URL. |
| <a id="property-createdat"></a> `createdAt` | `string` | Entity creation timestamp. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Optional description. |
| <a id="property-extra"></a> `extra` | \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} | Property fields that can be flattened into property-bearing Soup items. |
| `extra.properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |
| <a id="property-icaluid"></a> `icalUid` | `string` | RFC 5545 UID used for source reconciliation. |
| <a id="property-id"></a> `id` | `string` | Entity identifier. |
| <a id="property-isreadonly"></a> `isReadOnly` | `boolean` | Whether the selected canonical source is read-only. |
| <a id="property-lastreminderfiredat"></a> `lastReminderFiredAt?` | `string` \| `null` | When this event's most recent reminder notification was delivered. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Optional location label. |
| <a id="property-organizeremail"></a> `organizerEmail?` | `string` \| `null` | Organizer email. |
| <a id="property-organizername"></a> `organizerName?` | `string` \| `null` | Organizer display name. |
| <a id="property-ownerid"></a> `ownerId` | `string` | Owning Macro user. |
| <a id="property-status"></a> `status` | `string` | Canonical status. |
| <a id="property-time"></a> `time` | [`SoupCalendarEventTime`](SoupCalendarEventTime.md) | Canonical master time. |
| <a id="property-title"></a> `title` | `string` | Display title. |
| <a id="property-transparency"></a> `transparency` | `string` | Availability transparency. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Entity update timestamp. |
| <a id="property-visibility"></a> `visibility` | `string` | Canonical visibility. |
