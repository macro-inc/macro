# Composed memory

Memory context is built on each request from the owner's latest activity reports,
private explicit memory, and current teammates' professional profiles (including
the owner's profile). All sections use `prompt::compose`. Current team membership
is resolved through the teams domain; neither invites nor previous memberships
provide access. Only newly privacy-reviewed profiles are shared. Legacy one-shot
memory text stays in its old table for rolling deployment compatibility.

`ReadMemory` returns the owner's private document and revision. `UpdateMemory`
accepts a revision and an `edit` object (`action`, `line`, and content for insert
or replace). It applies a one-based insert, replace, or delete only on an explicit user request.
It rejects stale revisions, invalid lines, multiline content, and documents over
32 KB. Inserts and replacements pass privacy review before a compare-and-swap
write; deletion always remains possible. A replay of a successful edit fails with
a revision conflict instead of applying it twice. User corrections take precedence
over generated context. Generation cannot invoke memory mutation tools.

Cognition serves the same operations over HTTP for the SDK (`macro.memory.read()`,
`macro.memory.edit()`, `User.activity()`): `GET`/`PATCH /memory/explicit` and
`GET /memory/activity`. They admit any principal with an acting user, including
code-mode agent tokens, and act as that user. A stale revision answers 409 and a
rejected addition 422. Code mode hides the three tools in favour of the SDK.

`GetUserActivity` reads a bounded date interval for the caller or a current
teammate, including reviewed professional history from before they joined the
same team. Team associations record generation provenance; they do not restrict
reports to the team at the time of generation. Shared output describes professional work; source messages, sensitive
personal information, credentials, compensation, and other private details are
excluded by generation instructions and a separate, fail-closed judge: one
TypeSafe Jev call per piece, asking one yes/no question per privacy rule, each
with its own probability threshold (`crates/memory/src/outbound/jev_judge.rs`).
Explicit memory is held only to the sensitive-information rules. Model privacy
review is probabilistic, so this is not a deterministic redaction system.

Memory reads enroll users in `memory_refresh_job`; migration also enrolls existing
memory users. The cognition service runs an internal scheduled Rust closure on
startup and every five minutes outside the local environment. The closure claims
one user at a time with `FOR UPDATE SKIP LOCKED` and a 25-minute lease. A batch is
bounded to 25 claims; a user's model work is bounded to 20 minutes. Each claim of
the same day counts as an attempt, including one whose worker crashed. A failed
attempt is claimed again after 1, then 2 hours; the third failure gives the day
up: the pieces that passed review commit, the profile stays as it was, and the
user moves on to the next day. Failures do not prevent the remaining users from
running.
While the PostHog flag `disable-memory-refresh` is on for the service context
`memory-refresh`, no new user is claimed: the flag is read before every claim, so a
batch stops after the user in progress. A failed flag read keeps generation running.
Shutdown cancels and drains the tracked task. The CLI awaits one user's generation
and can be used locally with the existing provider and service configuration.

Each claim targets the first unprocessed UTC day that ended at least an hour ago,
so activity still arriving from Kafka is counted. A scheduled claim first asks
the activity crate whether the user has used Macro in the last 14 days
(`UserActivity::is_active`: a signed-in client open, or a change they made
themselves; agent, bot and code-mode work for them does not count). For a user
who has not, the day commits with no report and no new profile, so days pass
while they are away and are not caught up when they return; generation resumes
with the first day claimed after they are back. A failed read counts as active.
The one-user CLI does not ask. Then, before any model
call, the activity log (`activity_events`, views and appearance changes excluded)
is checked for that day; a day without activity commits with no report and no
new profile. Work done for the user counts here: for a user who is around, a
day on which only their agents worked is still reported. Each piece (daily, weekly, monthly, summary, profile) is stored in
`memory_refresh_piece` as soon as it passes review, and later attempts at the
same day reuse it instead of regenerating it; the day's commit deletes them. An unenriched user's
first date is the UTC day before enrollment, preserved across failed first runs.
Later days cannot leapfrog a missing day. The initial rollout does not synthesize
historical activity predating enrollment.

The generator uses an allowlist of read/search tools for daily evidence and a
separate professional profile. All model work is metered as the Memory feature.
A final privacy judge must accept each generated component before an atomic
commit guarded by the profile revision:

- Daily rows are append-only.
- Weeks start Monday, use daily rows, and stop changing when Sunday is complete.
- Months use complete weeks wholly inside the month plus uncovered daily rows,
  so cross-month weeks never import neighbouring-month activity or double count.
- The long-term summary combines its prior value with the newly completed day.
- Profiles are independently researched against current explicit evidence;
  job titles and employment are never inferred from activity.

User foreign keys cascade every new component and refresh job. Team associations
have their own index and cascade on team removal. Removing a membership immediately
removes access on the next read. The latest persisted report of each granularity
remains available if generation is delayed, with its actual dates in the context.

The scheduler's closure API is internal and does not expose arbitrary executable
code or AWS Lambda targets through routine configuration. The privacy judge needs
`TYPESAFE_API_KEY` on every host that saves memory; a host without it refuses every
save (503 for explicit edits). Local scheduled generation is disabled; use the
awaited CLI when testing model behavior intentionally.
