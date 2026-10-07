# Team calendar sharing

Team calendar sharing lets a current Macro teammate read a projection of events
another member can access through their connected calendars. Google remains the
authority for the connected account's upstream access. Macro owns the separate
decision to show that account's synced content to a Macro teammate.

This document describes the implementation contract and the rollout work needed
before enabling it in an environment. A checklist item below is a release
requirement, not a claim that the check has already passed.

## Permission boundaries

| Boundary | What it authorizes |
| --- | --- |
| Google OAuth scopes | Operations Macro may request as the connected Google account. |
| Google calendar ACL, event visibility, and Workspace policy | The representation Google returns to that connected account. |
| Current Macro team membership and the sharer's setting | A read-only Macro projection from an eligible synced source. |
| A viewer's independent Google access | Actions and content available through that viewer's own Google credentials. |

A Macro team share does not invite anyone, change a Google ACL, confer editing or
RSVP rights, or make an attachment or meeting accessible in its original service.
The teammate does not need a Google grant to view the Macro projection. If they
also have their own authorized copy, that independent access remains separate.

Google itself maintains organizer and attendee calendar copies. Those copies can
have different local properties and sharing contexts. A default-visibility event
can become visible through an attendee's shared calendar. Consequently, neither
organizer ownership nor the organizer calendar's ACL alone describes every
attendee copy's disclosure. See Google's [sharing model][google-sharing] and
[event propagation model][google-copies].

An event's `iCalUID` is useful for correlation, not authorization. Each team read
starts from one current eligible provider source and uses that source's normalized
event, occurrence, and exception snapshots. It must never fill missing details
from a richer canonical event or another user's copy. Team-derived access does
not become a new source for another team's access.

Google ACL `owner` means calendar manager access; it does not establish that the
connected account is the calendar's data owner. OAuth read permission also does
not itself describe consent to team redistribution. The release must accurately
disclose Macro's sharing behavior and review existing consent against the
[Google API Services User Data Policy][google-data-policy].

## Sharing and browsing

The user's sharing choice applies to their current Macro teammates:

| Setting | Teammates see |
| --- | --- |
| `busy_only` — default | Generic occupied intervals from synced calendars, without event titles, descriptions, guests, meeting links, or source calendar names. |
| `all` | Details from each eligible source for ordinary events. Private and confidential events remain generic busy intervals. |
| `none` | No access through this person's team calendar share. |

Browsing covers all eligible synced calendars, including subscriptions and
calendars directly visible through delegated accounts. It is not limited to
meetings the sharing member organizes or attends. A subscribed coworker's busy
event may therefore appear as shared source content without claiming that the
sharing member is personally busy; projections explicitly identify whether the
event contributes to personal availability.

Busy-only and private-event projections use a separate response shape, rather
than blanking fields on a full event object. Details are allowed only for
default/public visibility. An explicit private/confidential instance restricts
details, and an instance cannot unhide a private/confidential series. Google now
documents propagation of stricter recurring-instance visibility across a series;
preserving the instance field is defensive and does not assert that independent
private-instance behavior has been reproduced against Google.

Team projections are read-only. They are not ordinary owned event entities for
editing, deletion, RSVP, drag/reschedule, invitation, or copy-as-event-mention
actions. A team view does not expand calendar search or generic event-detail
authorization. Attendee `self` flags in detailed projections describe the viewer,
not the source calendar account.

Team projections and availability use server-confirmed source copies. An offline
edit can appear immediately in the editor's own calendar through the mutation
queue, but does not change what teammates see or their availability results until
the server commits the provider-backed change and the shared projection refreshes.
Queued local edits never enter the team projection cache.

## Personal availability

Browsing and availability answer different questions. The availability tool
computes a person's busy time from:

- Their directly connected primary calendars by default.
- Additional calendars they explicitly include in availability settings.
- Events on any eligible source where one of their owned email addresses is an
  attendee, even if that source calendar is otherwise excluded.

Secondary calendars require explicit inclusion because the current source model
does not prove Google data ownership. Merely subscribing to or managing a
coworker's calendar must not mark the subscriber busy. Delegated addresses do not
establish the user's personal attendance. Provider `self` flags alone are also
insufficient on subscribed calendars.

Cancelled, transparent, declined, birthday, and working-location entries do not
block time. Instance cancellation, attendee responses, and transparency override
the master where supplied. Accepted, tentative, and unanswered invitations can
block time. All-day intervals use each source calendar's IANA timezone, including
23/25-hour days and transitions that skip midnight; there is no UTC or requester
timezone fallback for a missing source timezone.

Copies are correlated by the sharing person, event UID, and original recurrence
identity. Equal intervals collapse. Disagreeing copies contribute their known
busy intervals conservatively and make free time unknown. Moving one occurrence
does not make it a different original recurrence instance.

`GetTeamAvailability` always includes the requester. With `userIds` omitted it
includes the current team; a supplied list narrows to those teammates plus the
requester, and an empty list checks only the requester. Unknown IDs never broaden
the selection. At most 100 selected teammates plus the requester are supported.
The requester's own setting of `none` does not prevent reading their direct
calendar sources for their own availability.

The domain computes merged busy intervals and coverage; the AI adapter forwards
one service call. Its result contains no event titles or meeting metadata.
`freeWindows` is omitted unless every requested person and the entire requested
range have complete coverage. Hidden sharing, absent calendars, incomplete or
stale sync, access changes awaiting resync, unknown IDs, invalid all-day zones,
conflicting copies, or truncation prevent a confident common-free result.
Known busy intervals can still be useful when coverage is unknown.

A malformed live event, recurring exception, or instance fails that calendar's
sync batch; it is never silently dropped while declaring the range complete.
The failed batch cannot advance its sync token or materialized coverage. A durable
calendar/account sync error withholds teammate access and free-time claims until
a successful retry represents the data. Genuine cancellation tombstones and
occurrences outside the requested range remain valid omissions.

Coverage requires recent successful account sync (currently within 15 minutes),
successful calendar state, materialization covering the requested range, and
source snapshots verified under the calendar's current access role. A calendar
must also carry the current strict-normalization version; a legacy worker's sync
completion is insufficient evidence of complete coverage. The all-day
source query pads local dates around the UTC range; final intervals are converted
using their own source zones and clipped to the exact requested instants.

Queries are bounded to the existing materialized horizon: one year past to two
years future, at most 370 days per request. Availability loads at most 20,000
source occurrences and reports at most 100 merged busy intervals per person.
Exceeding a bound never silently turns missing events into free time. Common
free windows cover the specified range only; working hours, travel, desired
meeting duration, and booking guarantees are outside this tool's contract.

## Provider changes and revocation

Current membership and sharing policy are checked on each server read. A
projection revision invalidates continuation cursors when relevant source or
entitlement facts change, and the service checks the revision again after reading
the page. Client caches must be discarded on the team-sharing refresh event,
account changes, and logout. A server denial must not leave previously cached
team details visible.

Provider access is asynchronous. Each calendar refresh reads the full CalendarList;
the implementation does not depend on incremental CalendarList to detect role
changes. Google documents that incremental CalendarList omits changes confined
to read-only fields such as ACLs. A detected access-role change clears the
calendar's sync/materialization state. Each source also records the access role
under which its snapshot was verified; mismatched or unverified snapshots are
ineligible until refreshed. Availability remains unknown while reconciliation
is incomplete.

Provider requests carry the calendar role observed for their exact account and
calendar before the request starts, including user edits. Persisting a delayed
response never labels it with a newer role merely because that role is now in the
database. If the role changed while an edit was in flight, its old-role snapshot
is withheld from teammates until reconciliation. Ordinary edits under the same
role remain eligible and preserve incremental sync. An identical response can
verify a snapshot only when its captured role still matches the current role.

Google may invalidate sync tokens after ACL changes; a `410` requires source
reconciliation. A full resync must remove absent copies and replace redacted
content rather than retaining old detail fields. Confirmed disconnection or loss
of a source removes that source's entitlement. A separately authorized remaining
copy may still be visible. See [Google sync semantics][google-sync].

Push notifications are hints: Google says they can be dropped, contain no event
payload, and require channel renewal. Keep the existing scheduler/polling recovery
active, and measure provider-revocation detection latency during rollout. A
provider ACL change is not an instantaneous Macro notification; the service must
not promise immediate revocation before it has observed the provider change.
See [Google push notifications][google-push].

The synced set is bounded too. CalendarList is a user's subscribed list, not an
enumeration of every theoretically accessible calendar. The current ingestion
selects calendars with event-reading access; free/busy-only Google calendars are
not a promise of complete event coverage in this release. Google may restrict or
omit guests and event fields; another source must never be used to reconstruct
those hidden fields.

## Rollout

The server gate is `CALENDAR_TEAM_SHARING_ENABLED`, default `false`. It must be
configured consistently for document storage, calendar service, and every AI/MCP
host exposing the availability tool. The web gate is
`enable-calendar-team-sharing` (local override
`VITE_ENABLE_CALENDAR_TEAM_SHARING`). A client gate is not an authorization
boundary. Keep the existing calendar sync gate enabled for accounts participating
in the rollout.

1. Apply the migrations, regenerate SQLx metadata, and deploy the server
   code with the team-sharing gate disabled. The coverage-reset migration clears
   sync tokens and materialized coverage for every live existing calendar,
   including empty calendars that may contain previously skipped provider data.
   This requires a one-time full resync. The normalization version and database
   invalidation trigger prevent legacy worker writes from certifying strict
   coverage. Drain all old calendar workers before activation and confirm the
   new workers have reconciled the calendars participating in release checks.
   Keep sharing disabled throughout the mixed-version deployment.
   Refresh existing source snapshots
   before expecting complete availability; do not backfill verification roles
   merely from a calendar's current role. The next normal calendar-list sync
   forces a full refresh for retained sources whose verification role is missing
   or mismatched, including pre-migration snapshots. Let scheduler/watch recovery
   drive this verification while the gate is off; monitor Google quotas and
   catch-up progress before activation.
2. Verify disclosures and the busy-only default in the sharing settings. Confirm
   that switching to details clearly covers subscribed/shared calendars too, and
   that availability inclusion is a separate setting.
3. Validate real Google accounts and separate browser sessions in an isolated
   internal/dev environment. The server gate enables sharing across its entire
   environment; a small web cohort does not restrict backend exposure or the AI
   tool. Activate the production server gate deliberately for the whole environment
   only after the release checks pass. A production rollout limited to selected
   teams requires an additional server-side team allowlist before that mode is
   used; it is not part of this change.
4. Verify source freshness, resync failures, unavailable coverage, invalidated
   cursors, and unauthorized/disabled responses before expanding the cohort.
5. Expand only after the checks below pass with the deployed provider integration.

Release checks:

- [ ] Busy-only serializes no event metadata; private/confidential stays masked
  under details sharing, including recurrence snapshots.
- [ ] A teammate without a Google connection can browse the permitted Macro view.
  They cannot edit, RSVP, invite, or use ordinary event-detail routes through it.
- [ ] A subscribed coworker's events are browsable but do not block the subscriber
  unless the subscriber attends or explicitly includes that calendar.
- [ ] Requester inclusion, unknown IDs, `none`, unavailable accounts, truncation,
  per-source all-day timezones, DST, declined instances, and moved instances are
  covered by domain tests and the tool renderer shows uncertainty.
- [ ] Sharing downgrade, team departure/removal, source disconnect, calendar
  removal, Google role downgrade, and a missed webhook remove stale access and
  cached details; a remaining independent entitlement is preserved.
- [ ] Real Google fixtures confirm role-downgrade/redaction and recurrence payload
  behavior. Synthetic normalization tests alone do not establish provider behavior.
- [ ] Relevant Rust tests, SQLx preparation, generated API/tool/SDK artifacts,
  TypeScript checking, `just check`, and browser verification pass.

Rollback: disable the server gate in all read/AI hosts first, then disable the web
flag and discard client team-query caches. Leave sharing preferences and additive
schema in place. Calendar sync and users' own Google access continue independently;
rollback must not revoke OAuth, mutate Google ACLs, or delete connected calendars.
After fixing the issue, reconcile source snapshots and repeat the internal-team
checks before enabling reads again.

## Implementation references

- [Team policy and source models](../crates/calendar_events/src/domain/team.rs)
- [Source repository](../crates/calendar_events/src/outbound/pg_team.rs)
- [Availability calculation](../crates/calendar_events/src/domain/team_availability.rs)
- [AI adapter](../crates/calendar_events/src/inbound/team_toolset.rs)
- [HTTP adapter](../crates/calendar_events/src/inbound/team_router.rs)
- [Database workflow](DATABASE_DEVELOPMENT.md)

[google-sharing]: https://developers.google.com/workspace/calendar/api/concepts/sharing
[google-copies]: https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events
[google-data-policy]: https://developers.google.com/terms/api-services-user-data-policy
[google-sync]: https://developers.google.com/workspace/calendar/api/guides/sync
[google-push]: https://developers.google.com/workspace/calendar/api/guides/push
