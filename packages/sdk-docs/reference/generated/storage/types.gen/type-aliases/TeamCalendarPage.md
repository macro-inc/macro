# Type Alias: TeamCalendarPage

> **TeamCalendarPage** = \{ `items`: [`TeamCalendarItem`](TeamCalendarItem.md)[]; `members`: [`TeamCalendarMember`](TeamCalendarMember.md)[]; `nextCursor?`: `string` \| `null`; \}

A bounded page of team calendar projections.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-items"></a> `items` | [`TeamCalendarItem`](TeamCalendarItem.md)[] | Authorized read-only projections. |
| <a id="property-members"></a> `members` | [`TeamCalendarMember`](TeamCalendarMember.md)[] | Current membership and sharing policies. |
| <a id="property-nextcursor"></a> `nextCursor?` | `string` \| `null` | Opaque continuation token; null after the last source occurrence. |
