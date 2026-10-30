# Type Alias: ConferenceProvider

> **ConferenceProvider** = `"microsoft_teams"` \| `"google_meet"` \| `"other"`

The conferencing system backing an event's join URL.

Calendars can create Google Meet or Microsoft Teams according to their
capabilities. Imported third-party conferences are labeled separately.
Omitting a conference change preserves the current conference; explicit
changes still require provider and calendar capability validation.
