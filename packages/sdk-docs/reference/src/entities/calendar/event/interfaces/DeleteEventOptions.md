# Interface: DeleteEventOptions

How a deletion is scoped across a recurring series.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendar"></a> `calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) | Calendar whose copy of the event is deleted, for a multi-calendar event. Omit to delete the canonical copy. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` | Original-start key of the occurrence a scoped deletion targets. |
| <a id="property-scope"></a> `scope?` | [`CalendarDeletionScopeParam`](../../../../../generated/calendar/types.gen/type-aliases/CalendarDeletionScopeParam.md) | Deletion scope; defaults to the entire event or series. |
