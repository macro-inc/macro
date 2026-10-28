# Type Alias: ViewerCapabilities

> **ViewerCapabilities** = \{ `editDetails`: `boolean`; `inviteGuests`: `boolean`; `organize`: `boolean`; `removeGuests`: `boolean`; `rsvp`: `boolean`; `setGuestPolicy`: `boolean`; \}

What the viewing requester may do with an event.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-editdetails"></a> `editDetails` | `boolean` | Change the event's details (title, time, description, conference). |
| <a id="property-inviteguests"></a> `inviteGuests` | `boolean` | Add guests. |
| <a id="property-organize"></a> `organize` | `boolean` | Act as the event's organizer: replace its whole guest list and manage its conferencing. |
| <a id="property-removeguests"></a> `removeGuests` | `boolean` | Remove guests. |
| <a id="property-rsvp"></a> `rsvp` | `boolean` | Answer the invitation. |
| <a id="property-setguestpolicy"></a> `setGuestPolicy` | `boolean` | Change the event's guest policy, which only Google calendars have. |
