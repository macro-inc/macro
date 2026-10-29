# Type Alias: GuestPolicy

> **GuestPolicy** = \{ `canInviteOthers`: `boolean`; `canModify`: `boolean`; `canSeeOtherGuests`: `boolean`; \}

The switches an organizer sets on an event to bound what its guests may
do. Google omits a switch from the payload while it holds its default.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-caninviteothers"></a> `canInviteOthers` | `boolean` | Whether guests may invite others. |
| <a id="property-canmodify"></a> `canModify` | `boolean` | Whether guests may change the event, including its guest list. |
| <a id="property-canseeotherguests"></a> `canSeeOtherGuests` | `boolean` | Whether guests may see the guest list. |
