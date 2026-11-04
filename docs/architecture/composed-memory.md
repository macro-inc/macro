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

`GetUserActivity` reads a bounded date interval for the caller or a current
teammate, including reviewed professional history from before they joined the
same team. Team associations record generation provenance; they do not restrict
reports to the team at the time of generation. Shared output describes professional work; source messages, sensitive
personal information, credentials, compensation, and other private details are
excluded by generation instructions and a separate, fail-closed judge. Model
privacy review is probabilistic, so this is not a deterministic redaction system.

Memory reads enroll users in `memory_refresh_job`; migration also enrolls existing
memory users. The cognition service runs an internal scheduled Rust closure on
startup and every five minutes outside the local environment. The closure claims
one user at a time with `FOR UPDATE SKIP LOCKED` and a 25-minute lease. A batch is
bounded to 25 claims; a user's model work is bounded to 20 minutes. Failures keep
their lease until it expires and do not prevent the remaining users from running.
Shutdown cancels and drains the tracked task. The CLI awaits one user's generation
and can be used locally with the existing provider and service configuration.

Each claim targets the first unprocessed completed UTC day. An unenriched user's
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
code or AWS Lambda targets through routine configuration. No new deployment or
provider credentials are required. Local scheduled generation is disabled; use the
awaited CLI when testing model behavior intentionally.
