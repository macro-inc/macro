# CRM email contribution

CRM access and email contribution are separate permissions. Existing and new
members start with CRM access. Admins and owners can deny or restore a plain
member in team member settings or through the API; admins and owners always retain access. A member
can use company and contact records without contributing a mailbox. Existing CRM
feature flags still control optional product surfaces such as pipelines.
Existing record hiding remains a separate admin action; blocking email never
hides or deletes a company or contact.

## Member access

Preference changes are rollout-gated by `enable-crm-member-access-changes`,
evaluated for service context `team-crm-member-access`. It starts off: missing
configuration, missing/disabled flags, or evaluation failure returns 503 without
updating the team. Enable it only after every old membership-removal writer has
drained and all access consumers are upgraded. Older removal compensation omits
the preference and would restore the default. Existing denial enforcement never
depends on this flag. Before rollback, disable writes and drain already-admitted
preference changes, including those waiting for database locks. Previously denied
memberships still require a compatibility decision before introducing older
writers or access consumers; disabling writes does not erase them.

`team_user.crm_access` defaults to true. Effective access is that flag or an
admin/owner role. Only a current admin/owner may change it; the mutation locks
both membership rows and rejects denying an admin/owner or self-restoration by
a denied member. Changing this flag never changes mailbox consent or exclusions.
A denied member can still manage their contribution consent.

Fresh primary-backed checks protect records, lists, batched record previews, CRM email/activity scope,
search, references, discussion access, and the CRM-derived grant to other
mailboxes' threads. Normal mailbox ownership and independent sharing grants
remain valid. A team-shared pipeline no longer grants access; an individual or
channel grant still can. Such a pipeline exposes its own fields, row values,
and opaque company/contact references. CRM names, domains, email addresses, and
record details resolve only with separate record access. Text copied into a
pipeline cell remains pipeline content and may itself identify a record.

`GET /crm/member-access` reads current authority without caching. Storage adds
`x-macro-crm-access` only when a client requests the retirement signal with
`x-macro-crm-access-signal: 1`. Requests without that opt-in perform no signal
authentication or CRM lookup. The hint uses a per-instance, 10,000-user LRU with
a non-sliding three-second lifetime from lookup start; concurrent requests for
the same resident user share a lookup. Failures and cancellations are memoized
too. A new user gets no hint when admitting it would evict an active lookup;
completed-entry eviction can cause an earlier cache miss. The primary
lookup runs alongside the handler, with a 200 ms lookup-future budget and a 250 ms total
signal budget including waits, after authentication extraction. Failure, timeout, or expiration before the
handler finishes omits the header; clients treat a missing hint as unknown.
A changed hint triggers a fresh authority read before the client changes its
cache policy; a memoized hint cannot restore access after a newer denied proof.
The timeout bounds waiting for the Rust future, not PostgreSQL execution: SQLx
connection recovery can continue after cancellation. The unchanged query remains
a unique-key membership lookup; this adds no database statement timeout.

This relaxes only the cache-retirement signal, never server authorization. A
revocation just after a cache fill can leave an allowed hint for less than three
seconds. The first opted-in request after expiry obtains a fresh hint or no
hint within the signal budget; receiving it also takes the authentication time, the handler's remaining
time, network delivery, and client retirement work. An idle or offline client
has no finite retirement deadline. Fresh authority reads and protected requests
still enforce revocation immediately.

The client opts into the hint for storage responses that can carry CRM content;
independent resources such as document creation and the fresh authority endpoint
skip it. A changed, missing, or invalid hint triggers a fresh
authority read; it never changes the policy directly. The response keeps its
pre-request generation even when that fresh read changes authority, so a late
response cannot be relabeled and admitted after retirement. Protected local reads
also require fresh authority. A changed permission retires normalized records,
derived search/projection rows, protected properties, persisted query lists, and
mounted observer snapshots. Browser and native owners serialize this work behind
a durable closed marker. Late responses, optimistic snapshots, and subscription
frames keep their original generation and cannot restore retired content. Legacy
database-row snapshots and unowned property snapshots have no reliable access
provenance, so they are also quarantined and unavailable offline until a fresh
authorized read restores them. Independently accessible mail and pipelines reload
through current server grants. Unrelated document/calendar data, authored draft
content, queued command variables, UUIDs, leases, and identity bindings survive.

A completed ordinary write returns its actual status and payload to the same
login even when later permission proof or cache admission fails. Only its cache
effects are discarded; a failed proof closes protected views through the normal
retirement path. Company/contact creation therefore closes the form after a
successful write instead of offering a retry that could create a duplicate.
POST reads and GraphQL queries still require content admission, and a replaced
login cannot receive an earlier login's write outcome.

Coordinator protocol 18 and the native permission commands must ship with this
web bundle. Older native binaries require an app update; there is no unguarded
cache fallback for the new bundle. New native binaries preserve the legacy cache
contract for older bundles that omit the whole `authority` argument; supplied
claims with missing or stale generations still fail closed. This reverse
compatibility supports native upgrades and web rollbacks, but does not add
retirement to an older bundle. Keep preference changes disabled until the client rollout is
complete, including already-open older builds. The server API cannot erase
content already downloaded by an older client.

Deploy the server's authority endpoint and CORS allowance for
`x-macro-crm-access-signal` before publishing this client. The client sends that
header on CRM-bearing storage requests even while preference changes are
disabled. A server rollback must retain the header allowance and endpoint while
opted-in clients remain active; otherwise browser preflights or fresh authority
reads fail.

Notifications follow the existing snapshot policy: a revoked member keeps
already-delivered CRM comment text and may still receive a previously queued
notification until delivery-time permission checks are added separately.
Opening its record always requires current access. Already copied text in
messages, documents, or agent transcripts is not retroactively redacted.

## Consent and exclusions

- Each person explicitly opts their primary mailbox into sharing the full content
  of all available past and future emails. Consent names the exact email-link ID.
  Secondary/new connections do not inherit consent. Mailbox lifecycle changes revoke the grant even if the connection keeps the same ID; ordinary token refresh does not. Leaving a team deletes consent.
- Team domains exclude every contributor. Any member may add one; existing team
  admin/owner roles may remove one. There is no separate CRM-admin role in the
  current membership model.
- Personal domains exclude only the caller's contributions. Another consenting
  teammate's copy may remain visible. Personal lists are returned only to their owner.
- A domain also covers subdomains, with a dot boundary: `acme.com` covers
  `sales.acme.com`, but not `notacme.com`. Any blocked sender/recipient in any
  non-draft message excludes the whole thread, including mixed-company threads.
- Adding an exclusion or withdrawing consent hides matching email contributions
  on subsequent CRM reads, including direct thread authorization. Existing company
  and contact records and prior interaction metadata remain. A normal mailbox or
  separately granted thread access is independent of CRM contribution.
- Removing an exclusion or opting in schedules a backfill. Both lists are shown
  before opt-in. The Team and Me tabs use the same CRM eligibility rules.

## Enforcement and boundaries

`EmailPrivacyService` in the CRM domain validates domains and authorizes typed team
receipts. The Axum GET/PUT `/crm/email-privacy` adapters only extract identity,
forward a command, and map the response. The SQL repository persists consent and
the two lists; it commits backfill requests in an outbox with the mutation.

CRM-scoped REST and GraphQL email previews read the primary database so a
committed withdrawal or exclusion cannot be undone by replica lag during refresh.
Ordinary inbox lists retain replica reads; primary failures never fall back to
stale CRM eligibility.

`crm_email_thread_allowed` is shared by CRM-scoped email listing and direct thread
access. It verifies the mailbox, current membership, explicit consent, and
whole-thread participant exclusions. `crm_email_domain_blocked` also honors
legacy company `email_sync = false` exclusions. The ingestion interaction scan
(`crates/crm/src/outbound/companies_repo/email_privacy/interactions.sql`) and the
Team view's read of one record's emails (`ALLOWED` in
`crates/email/src/outbound/email_pg_repo/dynamic/query/team_scope.rs`, with the
contributing inboxes in `dynamic/resolve.rs`) apply the same rules set-based, once
per call instead of once per thread and participant; change them together, and
keep their parity tests against the functions passing.
The Team view's read takes the inboxes that contributed when its filters resolved
and rechecks each thread against current consent, so a withdrawal hides an inbox
at once and a new grant shows it from the next request. Its address superset
relies on a message listing only its own inbox's contacts
(`parse_and_upsert_message_contacts`): a message naming another inbox's contact
can drop its thread from the Team view and let that thread hide the other copies
of its conversation. In both cases a lapse only hides email, never shows it. Writers and privacy changes use
shared/exclusive transaction advisory locks keyed by `crm-email:{team}`. Population
takes the shared privacy lock before the per-domain lock, parent-team `KEY SHARE`,
then mailbox `SHARE` and membership `KEY SHARE` before entity writes. Privacy changes take the exclusive lock first. Consent admission
retains the parent team, exact primary mailbox `FOR SHARE` and membership `FOR KEY SHARE` before writing consent; lifecycle
writers already own the mailbox row and revoke consent without taking a privacy
lock. This preserves mailbox-before-consent ordering and prevents an opt-in racing
a disconnect from reviving sharing.

Historical fan-out resolves the consented primary mailbox first. Each queued contact
job is admitted before metadata enrichment and rechecked inside its write transaction.
Interaction ranges are recomputed from eligible stored messages, rather than trusting
the old job's timestamps or direction. Only eligible sent history creates companies;
received-only history can update an existing company. Personal-provider contacts use the same consent and interaction checks, preserve the team’s personal-email filter, and are created without a company only from eligible sent history. Email bodies remain in the
email store; CRM grants access to eligible existing threads.

The email-service outbox worker publishes retryable historical jobs, then deletes
the outbox row in its transaction. Publication may duplicate after a crash; consumers
are idempotent and revalidate current consent and exclusions. After opt-out, pending
outbox requests are discarded by the publisher and already-published jobs no-op.
Withdrawing consent does not wait for an outbox row locked by a publisher's network
request. Other publishers skip locked requests and retry after a failed publication. Optional
W3C trace context is persisted with each request, adopted by the publisher, and
carried through queue delivery, retries, and contact fan-out without logging
mailbox identities or message payloads.

## Rollout

The first privacy migration starts with no individual consents. In one transaction,
it takes a write barrier on `team_crm_settings`, turns off the retired
`crm_enabled` switch, and installs a statement trigger that rejects any UPDATE
naming that column. This also rejects the UPDATE arm of a legacy enable/disable
upsert, including when its settings row is missing. The old disable transaction
therefore fails before its company/contact deletes. Plain settings creation still
coerces the switch to false; current governance updates and ordinary record/team
deletion remain available.

The barrier waits for previously admitted legacy write transactions to finish.
A five-second lock timeout rolls the entire migration back; the automatic
migration-first deployment then stops before deploying services. An old purge
that commits before the barrier is acquired is still pre-cutover behavior. After
successful cutover, old enable/disable endpoints return errors instead of purging
records or enrolling mailboxes. No manual endpoint-routing change is required for
this protection. Older readers and population workers fail closed on the false
switch, so CRM availability can be temporarily reduced during rolling deployment.
The existing CRM product rollout feature flag is unchanged.

Older consumers can acknowledge backfill work without populating records while
the retired flag is false. The initial automatic release therefore deployed
email-service and verified its pub/sub consumers before document-storage-service.
That one-time ordering was removed once every environment ran the new consumers;
both services now deploy in the shared parallel matrix like every other service.
Publication remains at least once and consumers revalidate eligibility.

Current team responses report CRM available. The old team-enable endpoint no-ops
without enrolling mailboxes; team-disable requests are rejected, preventing its
former purge behavior. Rollback removes the new privacy state and leaves the old
team switch off, requiring an explicit decision before old sharing is re-enabled.

## Historical verification

The following checks describe the October 14, 2026 implementation and its then-current
base. They do not establish validation of the later main integration or mailbox
lifecycle changes. Current-source checks are recorded with the PR review evidence.

- 639 Rust unit/integration tests passed: CRM library 247 plus 19 integration
  tests, teams 266, direct thread authorization 48, CRM email queries 28,
  Soup model and CRM association tests 23, and email backfill outbox 8. The live Apollo test
  remains ignored. Tests use a separately migrated local database and
  `RUST_TEST_THREADS=4`.
- Privacy coverage includes empty consent on rollout, rollback, withdrawal,
  mixed-thread BCC exclusions, subdomains, personal versus team scope, secondary
  mailboxes, membership removal, and stale ingestion jobs. Outbox coverage uses
  PostgreSQL and a local SQS test server for successful publication, retry,
  disconnected mailboxes, concurrent publishers, and withdrawal during publication.
- Frontend CRM and contact tooltip suites: 112 passed, including cache invalidation,
  failed withdrawal, disconnected mailboxes, and responses arriving after an
  identity change. Whole-app TypeScript checking and `just check` passed.
- Historical workspace SQLx preparation passed. Current preparation excludes test-query metadata, per the database development guide. Static
  queries use checked macros; dynamic email filters bind values. Ingestion uses
  existing mailbox/address, recipient, sender, and thread indexes, and aggregates
  by thread before evaluating whole-thread privacy.
- Desktop member/admin and mobile browser checks exercised the real privacy UI
  and query adapter against a local fixture: list edits, removal permissions,
  opt-in, withdrawal, dialog scrolling, banner state, and disconnected mailboxes.
  These browser checks do not exercise a deployed version of the new API.

### Manual contact edits and assigned personal addresses

Adding a missing email or linking/switching a personal-provider contact remains
available without mailbox consent. These edits never enable company email sync
or enroll a mailbox. The contact ID, name, archive state and manual company are
preserved during subsequent sync and source cleanup.

When the assigned company has email sync disabled, personal-email processing
skips interaction and source updates. An enabled company permits refresh only
from eligible stored history under valid exact-primary consent and applicable
team/personal exclusions. Contact email lists and direct CRM thread access keep
the same parent restriction. Reassignment coordinates with population and
privacy changes before acquiring domain/parent locks.
