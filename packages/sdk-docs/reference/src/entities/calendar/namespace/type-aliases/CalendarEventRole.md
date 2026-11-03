# Type Alias: CalendarEventRole

> **CalendarEventRole** = `"organizer"` \| `"guest"`

What the user is on one copy of an event, through the inbox holding it:
its organizer (or the owner of an event without guests), or a guest. Being
able to write someone else's calendar makes them neither, and neither does
a read-only calendar naming them organizer; `viewerCan` says what they may
do there.
