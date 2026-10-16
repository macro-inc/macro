# Type Alias: CalendarInvitation

> **CalendarInvitation** = \{ `attendees`: [`InvitationParticipant`](InvitationParticipant.md)[]; `comment?`: `string` \| `null`; `conference_url?`: `string` \| `null`; `description?`: `string` \| `null`; `dtstamp?`: `string` \| `null`; `end?`: `null` \| [`InvitationDateTime`](InvitationDateTime.md); `id`: `string`; `last_modified?`: `string` \| `null`; `location?`: `string` \| `null`; `method`: [`InvitationMethod`](InvitationMethod.md); `organizer?`: `null` \| [`InvitationParticipant`](InvitationParticipant.md); `recurrence_id?`: `null` \| [`InvitationDateTime`](InvitationDateTime.md); `recurrence_id_raw?`: `string` \| `null`; `sequence`: `number`; `start?`: `null` \| [`InvitationDateTime`](InvitationDateTime.md); `status?`: `string` \| `null`; `title?`: `string` \| `null`; `uid`: `string`; \}

Display snapshot of one meaningful VEVENT, owned by the email domain.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees` | [`InvitationParticipant`](InvitationParticipant.md)[] | Historical attendee identities and participation metadata. |
| <a id="property-comment"></a> `comment?` | `string` \| `null` | Reply or counter-proposal comment. |
| <a id="property-conference_url"></a> `conference_url?` | `string` \| `null` | Validated HTTP(S) conferencing URL; never fetched during rendering. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Plaintext description, retaining passwords and dial-in instructions. |
| <a id="property-dtstamp"></a> `dtstamp?` | `string` \| `null` | Scheduling timestamp in its original spelling. |
| <a id="property-end"></a> `end?` | `null` \| [`InvitationDateTime`](InvitationDateTime.md) | - |
| <a id="property-id"></a> `id` | `string` | Content-derived component identity, stable across repeated extraction. |
| <a id="property-last_modified"></a> `last_modified?` | `string` \| `null` | Last modification timestamp in its original spelling. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Plaintext event location. |
| <a id="property-method"></a> `method` | [`InvitationMethod`](InvitationMethod.md) | Original scheduling method. |
| <a id="property-organizer"></a> `organizer?` | `null` \| [`InvitationParticipant`](InvitationParticipant.md) | - |
| <a id="property-recurrence_id"></a> `recurrence_id?` | `null` \| [`InvitationDateTime`](InvitationDateTime.md) | - |
| <a id="property-recurrence_id_raw"></a> `recurrence_id_raw?` | `string` \| `null` | Original recurrence identifier spelling and parameters. |
| <a id="property-sequence"></a> `sequence` | `number` | Scheduling revision, distinct from delivery order. |
| <a id="property-start"></a> `start?` | `null` \| [`InvitationDateTime`](InvitationDateTime.md) | - |
| <a id="property-status"></a> `status?` | `string` \| `null` | Original event status. |
| <a id="property-title"></a> `title?` | `string` \| `null` | Event summary. |
| <a id="property-uid"></a> `uid` | `string` | iCalendar UID; never a Google provider event ID. |
