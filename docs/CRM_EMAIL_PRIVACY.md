# CRM email contribution

CRM records and email contribution are separate permissions. Every team member
can use company and contact records before contributing a mailbox. Existing CRM
feature flags still control optional product surfaces such as pipelines.
Existing record hiding remains a separate admin action; blocking email never
hides or deletes a company or contact.

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

`crm_email_thread_allowed` is shared by ingestion, CRM-scoped email listing, and
direct thread access. It verifies the mailbox, current membership, explicit consent,
and whole-thread participant exclusions. `crm_email_domain_blocked` also honors
legacy company `email_sync = false` exclusions. Writers and privacy changes use
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
