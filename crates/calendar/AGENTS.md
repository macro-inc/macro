# crates/calendar

## What it is

Calendar: events, sync and sharing (`calendar_events`), scheduling links (`calendar_scheduling`), and the cal.com booking webhooks (`cal`).

Layer: `domain` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| [`cal`](cal/AGENTS.md) | Part of Calendar: receives cal.com booking-event webhooks and fires analytics events in response. |
| [`calendar_events`](calendar_events/AGENTS.md) | Part of Calendar: owns the stable `CalendarEvent` entity — parsing from external sources (Google Calendar, Outlook, email invitations), mutation, reminder dispatch, team … |
| [`calendar_scheduling`](calendar_scheduling/AGENTS.md) | Part of Calendar: personal and Macro-team booking pages — event types, availability, collective/round-robin hosts, booking limits, and the booking lifecycle. |

## Recipes

- Add a crate here: create `crates/calendar/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
