# Type Alias: CalendarEventSearchScope

> **CalendarEventSearchScope** = `"own"` \| `"shared_with_you"`

Which calendar events a unified search covers.

Sharing an event with a channel lets its members see the sharer's copy,
which is on none of their own calendars, so the default scope never finds
it. Shared events are a separate scope rather than part of the default, so
a caller can list them after the caller's own events without reordering
those.
