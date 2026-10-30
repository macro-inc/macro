# Interface: DeleteEventOptions

How a deletion is scoped across a recurring series.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendar"></a> `calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) | Calendar whose copy of the event is deleted, for a multi-calendar event. Omit to delete the canonical copy. |
| <a id="property-inbox"></a> `inbox?` | `string` | Address of the inbox holding the copy this call deletes (an occurrence listing's `inbox`). When the meeting is on more than one of the user's inboxes, an agent must name it: the call is refused with `copy_choice_required`, listing each copy's inbox, role and event, until it does. It must be the inbox holding this copy. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` | Original-start key of the occurrence a scoped deletion targets. |
| <a id="property-scope"></a> `scope?` | [`CalendarDeletionScopeParam`](../../../../../generated/calendar/types.gen/type-aliases/CalendarDeletionScopeParam.md) | Deletion scope; defaults to the entire event or series. |
