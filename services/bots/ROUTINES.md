# Routines for Macro and integrations

Routines complement the event-driven bots in this directory. The Stripe bot posts
payment and cancellation notifications; the Anthropic status bot posts provider
incident updates. A routine can turn those messages into a useful briefing
without changing either bot's ingestion behavior.

The frontend's **Agents → Routines → Explore templates** includes these starters:

| Routine | Sources | Suggested cadence | Result |
| --- | --- | --- | --- |
| Start the day informed | Tasks, conversations, calendar | Weekdays, 09:00 | Deadlines, blockers, decisions, source links |
| Keep the team in sync | Referenced project channels | Friday, 16:00 | Draft progress report and next priorities |
| Catch work that slipped | Open tasks and project conversations | Monday/Wednesday/Friday, 15:00 | Prioritized follow-up list |
| Walk into meetings prepared | Calendar and linked Macro context | Weekdays, 08:30 | Objectives, recent decisions, open questions |
| Spot revenue signals | Stripe bot channel messages | Weekdays, 09:30 | Payment events and cancellation follow-ups |
| Follow up on incidents | Anthropic status bot posts | Daily, 10:00 | Active incidents, latest updates, observed impact |
| Review what shipped | An agent's GitHub connection | Weekdays, 16:30 | Merges, releases, failed checks, waiting reviews |
| Keep the issue queue moving | An agent's Linear connection | Weekdays, 10:30 | Urgent unassigned, blocked, or duplicate issues |

Templates create editable drafts. Add the relevant channels, repositories, or
teams to the instructions and select an agent with access. Reports link their
sources and distinguish observed facts from inference. Stripe notifications are
not a complete revenue ledger; status-channel posts are not a live status probe.
The templates return results for review rather than sending messages or changing
external systems automatically.

Useful one-offs include checking an incident again in an hour, preparing tomorrow's
customer meeting, asking a release agent for a post-release summary, or delegating
a follow-up to a specialist agent after the current session ends.

Agents can use `CreateRoutine` with `target: {"type":"agent","agentId":"…"}`
(the persona `botId` from `ListBots`) and
`schedule: {"type":"once","at":"2030-10-03T09:00:00-04:00"}`. To schedule
itself, an agent selects its own persona ID. The authenticated user owns the
routine, and the scheduler validates access to the selected agent. Recurring
routines use `{"type":"cron","expression":"0 0 9 * * 2-6","timezone":"America/New_York"}`.
Use `ListRoutines` to avoid duplicates, `ReadRoutine` to inspect settings/results,
and `UpdateRoutine` to pause or change future work. A routine should not create
a replacement of itself on each run.
