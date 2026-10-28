# Type Alias: InvitationParticipant

> **InvitationParticipant** = \{ `email`: `string`; `name?`: `string` \| `null`; `participation_status?`: `string` \| `null`; \}

Scheduling participant; saved responses are historical, not current RSVP.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email` | `string` | Participant calendar address. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Sender-supplied display name. |
| <a id="property-participation_status"></a> `participation_status?` | `string` \| `null` | Original PARTSTAT, retaining extensions. |
