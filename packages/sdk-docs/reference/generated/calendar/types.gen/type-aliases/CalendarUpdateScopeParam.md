# Type Alias: CalendarUpdateScopeParam

> **CalendarUpdateScopeParam** = `"all"` \| `"this_event"`

How much of a recurring series an update applies to.

Like RSVPs there is no this-and-following variant: the provider cannot
express a forward-scoped edit as one write, and emulating it (truncate
the series, insert an edited clone) is non-atomic and re-invites the
attendees of the clone. Compose it from a this-and-following deletion
and a create when that shape is wanted.
