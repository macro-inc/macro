# Interface: InviteGuestsOptions

Guests to add and how much of a recurring series gains them.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendar"></a> `calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) | Calendar whose copy of the event is written, for a multi-calendar event. Omit to write the canonical copy. |
| <a id="property-guests"></a> `guests` | [`CalendarGuestInputBody`](../../../../../generated/calendar/types.gen/type-aliases/CalendarGuestInputBody.md)[] | Guests to add; anyone already on the event is skipped. |
| <a id="property-inbox"></a> `inbox?` | `string` | Address of the inbox holding the copy this call changes (an occurrence listing's `inbox`). When the meeting is on more than one of the user's inboxes, an agent must name it: the call is refused with `copy_choice_required`, listing each copy's inbox, role and event, until it does. It must be the inbox holding this copy. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` | Original-start key of the occurrence the guests are added to. |
| <a id="property-scope"></a> `scope?` | [`CalendarUpdateScopeParam`](../../../../../generated/calendar/types.gen/type-aliases/CalendarUpdateScopeParam.md) | How much of a recurring series gains the guests. Omit to let `recurrenceId` decide. |
