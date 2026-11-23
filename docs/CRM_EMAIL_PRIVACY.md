# CRM email contribution

CRM access and email contribution are separate permissions. Existing and new
members start with CRM access. Admins and owners can deny or restore a plain
member in Team > Members, in CRM settings' Who can use CRM, or through the API;
admins and owners always retain access. A member
can use company and contact records without contributing a mailbox. Optional CRM product surfaces retain their own rollout gates.
Existing record hiding remains a separate admin action; blocking email never
hides or deletes a company or contact.

## Member access

Preference changes are rollout-gated by `enable-crm-member-access-changes`,
evaluated for service context `team-crm-member-access`. The admin switch uses
the same remote key and stays hidden until enabled. It starts off: missing
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
A denied member can still manage their contribution consent and list, set or
clear their own thread exceptions. The thread-exclusion rollout gate still
applies; CRM viewing permission is not required for these contribution controls.

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
has no finite retirement deadline. Fresh authority reads and newly started protected requests
still enforce revocation immediately.

The client opts into the hint for storage requests, except the fresh authority
endpoint. A valid changed hint or a CRM 403 schedules a fresh authority read in
the background; the hint never changes policy directly. Boot, focus and
reconnect also refresh authority. No email response, subscription frame, cached
read or ordinary request waits for that proof. Missing hints remain unknown and
do not cause per-response polling.

One owner-issued generation fences all response content. Requests and
subscription sources retain the generation captured before dispatch. On an
access transition, older reads and frames are discarded and active queries
refetch. Writes compare the same generation under the shared native owner lock
or browser worker. There are no CRM admission classifiers or ownership witnesses
on these paths. The existing account fence remains independent.

Startup renders without waiting for the local store. Initialization keeps the
host's phase deadlines and classified failure handling, so a slow asset load or
retry cannot become a permanent queue failure through a separate owner timer.
A profile-scoped
localStorage mirror supplies the account, policy string and generation as hints;
missing or unreadable mirrors send an explicit nonmatching UUID. Windows update
the mirror from validated owner observations, without treating cross-window
storage events as authority. A matching account and policy with a different
generation corrects stamps for new requests without retiring in-memory responses.
Copied data retains its original stamp, is rejected at the shared store when
stale, and recovers with a fresh read of its own query. A different account or
known policy, or a denied/incomplete first observation triggers normal visible
retirement. A missing or unreadable mirror alone is not an access change. A first
non-denied owner initializes the current stamp while preserving mounted observers,
rows, open menus and persisted snapshots. This also applies to the first launch
after upgrading a bound legacy owner with no
policy. TanStack keeps existing data and in-flight reads without refetching; urql
rereads only the queries whose original copied writes the shared owner rejects,
in the background while their current rows remain visible. Recovery dispatches
inside the exchange so cache rereads cannot replace the required network read;
its fresh persisted page then receives subsequent mutations and realtime updates.
Physical resets
issue new owner generations, so
delayed or missing mirror updates cannot admit pre-reset content.

A deny-then-grant cycle during startup can return to the same account, team and
allowed status. In-memory bodies from the last observation remain visible under
the accepted offline semantics until normal refetching updates them. Matching
account, team and allowed status does not prove current access to each thread:
a mailbox owner may have withdrawn consent while the member was denied.
Copied writes still require an exact generation match at the owner. On web,
a ready allowed mirror for the signed-in
account may open CRM UI before storage is ready. A missing mirror and unknown
owner also start a short, UI-only server proof in parallel with storage. Its
result is bound to that login and host and cannot override an owner observation.
It never commits policy: the normal proof starts after reading the owner's
generation and commits under that generation check. This first launch uses two
permission reads; returning launches normally use one. Native uses neither early
UI path because CRM email-list REST pages can restore independently from IndexedDB
before the owner finishes interrupted cleanup. Its ready allowed local owner
opens CRM without waiting for network proof. None of these UI paths changes
storage admission or server authorization.

An in-flight document or file load superseded by retirement retries its complete
load once, from its source identity with fresh credentials. This includes direct
binary reads outside active TanStack queries. It does not replay an old presigned
URL, reload an already-open editor, or retry indefinitely through further changes.

Before deleting snapshots, the owner durably records the new policy and marks
retirement incomplete. Interrupted retirement resumes before returning cached
content. Initial allowed/team-less proofs preserve legacy offline data and the
existing generation. A proven denial or a change of team retires CRM records,
derived mail/database-row families, protected properties, mixed query lists and
projection-only orphans. This conservative cleanup can remove independently
accessible mail or database data; fresh authorized reads restore it. Normalized
email-thread storage and native-mobile Soup persistence remain available until
proven denial. The legacy TanStack `email-threads` scope remains disabled, as on
main; it is retained only to remove snapshots saved by earlier versions.

Owner privacy query families (`emailPrivacy`, `emailConsent`,
`excludedEmailThreads`, `emailPolicy`, `emailPolicyHistory`,
`emailPolicyRevision`, `emailPolicyPreview`) survive CRM-access retirement.
They remain authorized without CRM viewing access, so the settings editor keeps
its draft during revalidation. Account/session retirement still clears them.
Company and contact rule labels do not fetch previews while access is denied;
the member's own thread labels remain available. Preview commands preserve their
server outcome across retirement but re-read instead of publishing stale counts.

Authored draft content, queued variables, UUIDs, leases and identity bindings
survive retirement. Successful mutations keep their real server outcome. Stale
queued responses settle identities without copied response content, projections
or link recipes, then revalidate. The draft journal receives the actual result
before that discard. A confirmed local settlement retry retains the original
request generation; a fresh HTTP attempt captures a new one. A mutation waits
only for its affected publications, so an unrelated read cannot hold its notice.

Malformed persisted mutation entries can prevent retirement from completing.
The durable marker stays incomplete and owner commands retry cleanup and fail
until the queue is repaired. Existing queue hydration also rejects these
entries. Isolating their copied snapshots without losing authored metadata is a
separate recovery improvement; retirement does not delete authored commands.

CRM routes initially show loading. A failed initial proof ends in the existing
retry state after at most one network/stale-generation retry; the second network
attempt has a short timeout. Manual retry and reconnect restart verification.
Transient failure retains the last proven allowed/denied state. Only a proven
denial closes CRM views and dialogs. An offline device may retain allowed cached
content after revocation until its next server contact; already-rendered content
stays until rerender. This design introduces no offline TTL.

Team-view list edits still obtain a network-only settings baseline inside their
serialized mutation and retain the authoring account/session through the write.
A failed baseline read prevents PUT. Cross-client edits retain their existing
last-write-wins behavior.

Coordinator protocol 18 and the native permission commands must ship with this
web bundle. Older native binaries require an app update; there is no unguarded
cache fallback for the new bundle. New native binaries preserve the legacy cache
contract for older bundles that omit `generation`; new hosts always send an
explicit stamp for copied writes, including before initialization. Supplied
older or unknown generations are rejected under the shared owner lock. This reverse
compatibility supports native upgrades and web rollbacks, but does not add
retirement to an older bundle. Queue inspection sanitizes copied optimistic data
for every caller, so an older bundle with legacy queued `SaveEmailDraft` entries
may lose that optimistic display/recovery data after rollback. Authored command
variables remain; current bundles also use the preserved legacy recovery metadata.
Keep preference changes disabled until the client rollout is
complete, including already-open older builds. The server API cannot erase
content already downloaded by an older client.

Deploy the server's authority endpoint and CORS allowance for
`x-macro-crm-access-signal` before publishing this client. The client sends that
header on storage requests even while preference changes are
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
- Thread exceptions exclude only the mailbox owner's copy of one thread for this
  team, including messages already shared and future messages in that same thread.
  A different member's eligible copy of the same conversation remains visible,
  including overlapping messages; this is not a team-wide redaction. Ordinary
  mailbox access and separately granted access remain independent.
- Sales Email currently reads the viewer's own mailbox, not teammates'
  contributed copies. Their own copy remains visible there, matching personal
  blocked-domain behavior; thread exceptions do not change that mailbox access.
- Owners add an exception from their thread's **Exclude thread from CRM**
  action beside sharing in its menu, or the desktop icon before the reminder
  bell. Both explain when ownership or mailbox consent prevents exclusion.
  A failed background check preserves the last known exclusion state while
  disabling the action until a successful read.
  **Email settings → Excluded threads** lists only their own exclusions, fifty
  per page. Each thread uses the existing email mention (icon, subject, hover
  preview, and split navigation). Inline titles come from the owner-scoped list;
  full previews load only when opened. **Remove** clears the exclusion without
  opening the thread, including after mailbox sharing is turned off. Removing
  an exception restores eligibility only if consent and every other exclusion
  still allow it.
  The same controls are available in the phone menu and settings drawer.
  `GET /crm/email-privacy/threads?thread_id=<uuid>` returns zero or one own
  exclusion for the header, with no continuation; `after` and `thread_id` are
  mutually exclusive. Header and settings readers share cache invalidation;
  successful thread changes cancel pending owner reads before refreshing them,
  so a response from before the write cannot restore a removed exclusion.
- Thread exceptions do not immediately recompute first/last interaction dates,
  matching personal blocked domains. Existing company/contact records, archive
  state, sources and prior interaction metadata remain. Normal population uses
  only eligible stored messages when it next updates interaction ranges.
- A domain also covers subdomains, with a dot boundary: `acme.com` covers
  `sales.acme.com`, but not `notacme.com`. Any blocked sender/recipient in any
  non-draft message excludes the whole thread, including mixed-company threads.
- Adding a domain that covers an affected connected primary mailbox is refused
  with HTTP 400 and the usual `{ message }` validation response. Team blocks
  protect every current member, independent of consent or CRM viewing access;
  personal blocks protect only the caller. Company sync-off and archive apply
  the same guard because they also create domain exclusions. The SDK surfaces
  the server explanation. A child of the mailbox domain is still permitted.
  Settings explain refusals at the input and report existing matches beside
  their entries, without removing them. Company-domain explanations note that
  own-domain colleagues are already skipped; personal-provider explanations
  only describe the whole-mailbox email effect.
- Adding an exclusion or withdrawing consent hides matching email contributions
  on subsequent CRM reads, including direct thread authorization. Existing company
  and contact records and prior interaction metadata remain. A normal mailbox or
  separately granted thread access is independent of CRM contribution.
- Removing an exclusion or opting in schedules a backfill. Both lists are shown
  before opt-in. The Team and Me tabs use the same CRM eligibility rules.

## Enforcement and boundaries

Selected contribution has versioned member/mailbox rules, actor history and
compatible eligibility readers; see the [phased design](design/crm-selective-email-contribution.md).
No public operation activates it yet. Existing consents keep `mode = all` and
their original `enabled` value. A selected grant uses `enabled = false` and a
separate `selected_enabled` bit. Compatible readers recognize either grant;
older binaries ignore selected grants. Database guards reject legacy opt-ins
on selected rows, make legacy withdrawals clear both bits, and increment the
policy version when effective consent changes. Mailbox lifecycle revocation
clears both bits without reviving them on reconnect.

All three eligibility implementations resolve the active revision's thread,
address, contact, domain and company selectors. One matching non-draft participant
shares the whole thread. Contact selectors use every current `crm_contact_emails`
address; company selectors use current company domains and their subdomains.
Resolution requires the source record to remain in the contributor's team and
visible to their current role, including a contact's parent company. Deletion or
hiding from that role removes its match; changes take effect on subsequent reads.
The contributor's CRM viewing preference does not revoke contribution. Team and
personal domain vetoes and private-thread exceptions still win, and another
contributor's mailbox-local copy is evaluated independently.

`EmailPrivacyService` in the CRM domain validates domains and authorizes typed team
receipts. The Axum GET/PUT `/crm/email-privacy` adapters extract identity,
forward a command, and map the response. Thread controls use
`GET /crm/email-privacy?consent_only=true`: only the effective `enabled` bit and
current `mailbox_email`/`mailbox_link_id`, without any domain queries. Its
owner/session CRM cache key is separate from the full settings response; privacy
mutations update both and refresh thread-exclusion queries.
`set_thread_exclusion` takes `thread_id`
and `excluded`; identity always comes from the authenticated team receipt, and
both setting and clearing require ownership of that thread's mailbox. It is
idempotent and can be set before consent. `GET /crm/email-privacy/threads?after=…`
returns the owner's keyset-paginated exceptions and their current subjects.
The SQL repository persists consent, domain lists and thread exceptions; it
commits backfill requests in an outbox with the mutation.

CRM-scoped REST and GraphQL email previews read the primary database so a
committed withdrawal or exclusion cannot be undone by replica lag during refresh.
Ordinary inbox lists retain replica reads; primary failures never fall back to
stale CRM eligibility. A successful privacy write stays saved if a client refresh
fails: other readers and the owner's exception pages still refresh, and the UI
reports the refresh failure separately with a reload prompt.

`crm_email_thread_allowed` is shared by CRM-scoped email listing and direct thread
access. It verifies the mailbox, current membership, explicit consent, and
whole-thread participant exclusions. The separate
`crm_email_thread_excluded(team, user, link, thread)` predicate is a veto regardless
of domain eligibility. `crm_email_thread_exclusions` holds team/member/mailbox/thread
identities, with deletion cascades for membership, mailbox and thread. Selected
inclusion retains this veto. Labels and folders are not implemented: future
target-specific exclusion tables can keep their own foreign keys and add
predicates alongside this one, without changing thread exceptions.
`crm_email_domain_blocked` also honors
legacy company `email_sync = false` exclusions. The ingestion interaction scan
(`crates/crm/src/outbound/companies_repo/email_privacy/interactions.sql`) and the
Team view's read of one record's emails (`push_allowed` in
`crates/email/src/outbound/email_pg_repo/dynamic/query/team_scope.rs`, with the
contributing inboxes in `dynamic/resolve.rs`) apply the same rules set-based, once
per call instead of once per thread and participant; change them together, and
keep their parity tests against the functions passing.
The Team reader calls `crm_email_thread_excluded` for each candidate and each
competing copy before choosing the conversation's representative.
The Team view's read takes the inboxes that contributed when its filters resolved
and rechecks each thread's consent and exclusions. Every Team reader uses
one read-only repeatable-read snapshot for mode resolution, discovery and page, like
the Owned reader, so an import cannot make a previously sparse set dense between statements.
An in-flight request answers from that snapshot; a withdrawal or new exclusion
committed during it takes effect on the next request. A new grant also shows mail
from the next request. General fallback reads retain that snapshot, including
when the initial resolution finds only all-mail contributors; opening a new
transaction could otherwise read a selected policy that skipped discovery.
Its address superset
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

The policy repository stores a server-generated `consent_incarnation` for each
consent lifetime. Inspection is side-effect free with the rollout flag on or off:
no consent row, identity initialization or historical work is created. Flag-on
legacy inspection returns a fingerprint token; flag-off legacy inspection is
read-only without an editable token. The first mutating request compares the
observed legacy state under mailbox/membership and privacy locks, initializes
identity without changing its grant, and transfers unfinished legacy history
atomically. This includes already-published work. Workers never initialize
identity. Membership leave cascades consent, and rejoining creates a fresh
incarnation before a new grant.

Modern tokens bind incarnation/version plus explicit mailbox and member authority;
legacy tokens also distinguish the existing consent row. Mailbox owner, primary,
deletion/disconnect/reauth state, grant identity/generation, team role and CRM
access changes cause a conflict. Sync activity, provider/history cursors,
`updated_at`, billing plan and seat fields do not. At submit the service rechecks
current eligibility under locks. A transient reauth that clears on the same
mailbox/grant is accepted when consent did not change; an actual revocation
changes version and cannot be undone by a delayed request. These checks add no
mailbox/member columns or triggers. Live target changes intentionally retain the
policy token and invalidate previews separately.

The own-member routes under `/crm/email-privacy/policy` provide GET/PUT,
`POST /validate`, `GET /history`, `GET /revisions/{revision}`, GET/POST `/preview`
and `DELETE /preview/{preview_id}`. Signed member-authorized agents activate
directly, with trusted provenance in the private audit trail. No administrator
can act for another member; scoped credentials retain their sharing refusal.
Inspection, history, saved definitions and withdrawal remain available when the
flag is off. CRM viewing denial does not remove private sharing controls.
The SDK exposes these routes under `macro.crm.emailPrivacy`, alongside existing
consent/domain/thread controls. Rule selectors take entity handles; inspection
creates handles without fetching CRM targets or mail content. `get()` reads
policy state, `settings()` reads domain exclusions, and `excludedThreads()`
iterates private exceptions. Separate reads avoid loading every exclusion for
an agent that only needs the policy token. Existing `crm.blockDomain` and
`unblockDomain` remain team-wide; their nested email-privacy counterparts are
personal. `setConsent(false)` retains legacy withdrawal while the gate is off.

SDK replacements, mode changes and modern withdrawal require the exact observed
token and a caller-supplied idempotency key. No conflict triggers an automatic
inspection or retry. Preview handles retain one slot identity; after replacement
they cannot read or cancel the newer preview. History is lazy and keyset-paged;
saved-definition handles load only on request. Code-mode documentation explains
whole-thread/live effects, overriding exclusions, retained CRM records and
partial counts. The member settings editor remains a separate UI proposal;
these wrappers change no server gate or rollout configuration.

Audit and policy-command outcomes carry incarnation/version. Preview and
historical work each occupy one replaceable member slot. Preview starts compare
`if_policy` and the observed `if_preview_id`; an identical request reuses its
stored progress or terminal outcome. A replacement must name the current slot
and receives a new server-generated preview ID. Keeping the slot after completion
or cancellation prevents delayed starts from resurrecting older work, without
initializing consent for a legacy preview.

Historical checkpoints and completion compare generation and work identity.
Small policy-command and source-event retry receipts remain until mailbox or
membership cleanup. A separate durable work row survives outbox publication;
null generation fields in the existing outbox denote legacy work. The first
explicit modern mutation restarts eligible history under its new generation.
Untouched all-mail members keep the legacy worker path. Mailbox or membership
deletion cascades private envelopes; deleting only consent cannot make old retry
results valid.

Contact address/parent edits, hides, company-hide cascades and sync deletion
record source events in the same transaction, only for referenced targets.
Imports of new IDs and metadata-only enrichment keep their existing write paths;
there are no per-row source triggers. Direct SQL and future matching writers
must use the same event hook. Existing mailbox teardown and company/contact
visibility edits preserve the caller's statement timeout. Worker-owned metadata
transactions retain their 15-second statement and 5-second lock limits.
The worker pages at most 100 raw saved-rule references before checking whether a
revision is active, so inactive history cannot turn a miss into an
unbounded scan. Reverse indexes live only on `crm_email_rule_contacts` and
`crm_email_rule_companies`; ordinary mail ingestion maintains neither. Source
IDs have no record FK so deletion can still be reconciled. Team deletion removes
its pending source events. Active selected policies receive coalesced history
and content-free system audit entries; stable event receipts prevent duplicate
history after a retry. Matching edits also invalidate preview metadata in the
same transaction. Bulk teardown keeps its original plain deletes with no rules;
a fresh team-level reverse-index probe after deletion detects first activation
that committed while teardown waited. It emits one coarse team reconciliation
event, paged over raw consent owners. Referenced deletion returns IDs and resolves
references in a new statement. No team privacy lock is held through bulk teardown.

The separate preview poller scans a read-only repeatable-read mailbox snapshot,
100 raw threads per page, at most 10,000 threads and five minutes from enqueue.
Statements have at most 15 seconds, reduced to remaining time. Results are counts
only; partial results are lower bounds. A retained member slot, a thirty-second
new-request interval, conditional completion and cancellation bound retries and
late writes. Previewing never initializes consent or schedules contribution.
Ordinary mail imports preserve its as-of result; matching/privacy changes mark it
stale. The only new due index is on preview metadata, not email tables.

Deploy compatible source-event and preview workers before enabling authoring.
The initial default-off rollout has no saved rule references and emits no coarse
`team` events. After activation, teardown can emit those events even with the
flag off; pre-3c workers cannot deserialize them. Stop the new event producers
and drain their events with compatible workers before rolling workers back.
Disabling the flag alone is not a compatible worker rollback.

Modern history pages at most 100 raw mailbox contacts through the existing
mailbox/address index, with sent-capable contacts before the received pass.
Each contact reauthorizes before enrichment and in the population transaction;
page completion compares incarnation, version, work ID and cursor. Same-lifetime
version changes durably restart unfinished history; a different incarnation
cannot adopt an old job. The outbox retains a 15-minute recovery signal until
progress republishes it or exact-generation completion removes it. Legacy
publication still deletes its outbox row and uses the existing contact fan-out;
legacy history cannot consume initialized consent. New live-mail hints carry an
explicit marker and reconcile against current stored eligibility. The first sharing mutation
replaces unfinished legacy history atomically when initializing identity;
old unmarked live notifications must be drained before activation.

Selected contribution remains default-off under
`enable-crm-selective-email-contribution`; the policy API refuses grants if the
flag is false, missing or unavailable. The earlier eligibility migration refused to run
if any consent is already in selected mode. It replaces the SQL function before
new binaries roll out, while older Team and ingestion queries still require the
legacy bit. That window is safe because every existing consent is all-mail and
the policy API had not yet shipped. The flag must remain off until all
three readers, generation-safe historical work and the PR 5
performance gates pass, including the 1m-thread mailbox tier and a work bound for
unmatched live target expansions and mailbox-contact discovery. The positive-
thread probe's result cap alone does not bound that discovery work. CRM-scoped
email search is deferred and rejects CRM filters with HTTP 400 without reading
team mail; fourth-reader eligibility parity is required before activation only
if that search ships first. Audit all live-source event producers, including
member role changes, before activation. The API phase must also close the
first-activation/bulk-deletion race: target locks and a fresh reference check
must cover references committed while teardown waits, without holding the team
privacy lock across long cascades. The remote flag controls future writes,
never enforcement of stored restrictions.

The optimized and General Team readers resolve contribution modes inside their
read snapshot.
When none of the requested contributors uses selected mode, the optimized reader
emits the existing all-mail probe and page SQL without selected-rule CTEs or
predicates. General keeps its scalar page SQL and skips selected discovery in
that case. Mode changes committed during a request apply to the next request,
just like withdrawals and
private-thread exceptions. Deterministic transition tests cover both directions.

The Team reader keeps a shared ten-second deadline for its probes and pages.
For selected mailboxes, an injected CRM discovery core resolves each distinct
live contact/company source once and preserves each contributor's visibility.
The positive-target probe and page reuse its complete contact IDs in the same
snapshot. A small-input path is selected before expansion (up to eight selected
contributors and 4,000 raw references); larger scopes fold shared sources and
keyset-page mailbox contacts. Exact-address policies use existing indexed
lookups until their estimated cross product exceeds 50,000, then scan within the
same work budget. No hot email-table index is added.

Discovery caps contributors (1,000), raw references/live contact addresses/live
company domains (50,000 each), one live value (4 KiB), source text (8 MiB), raw
mailbox contacts (250,000), contact text (32 MiB), suffix checks (750,000),
membership checks (250,000), and its shared deadline (ten seconds). Counts apply
before filtering/deduplication. Suffix checks apply only to mailboxes with their
own applicable domain selectors, including live company domains. A complete
result or an explicit error is required; truncating discovery cannot authorize
a partial feed. The small SQL aggregate may materialize the bounded raw page
before the text-byte check.

Both policy validation and replacement use this same checker against the
proposed owner policy and the other active selected contributors. Validation is
read-only; replacement repeats admission inside its locked transaction before
granting. Successful admission restores the mutation's existing 15-second
statement timeout for subsequent writes. Failure returns HTTP 400 with the limit
name/maximum and leaves consent, identity, historical work, audit and idempotency
unchanged. Subsequent live-source growth may exceed a bound: Team reads then
return HTTP 503 with that limit,
record the limit and work counters on `crm.email_rules.discovery`, and return no
partial result or advanced cursor. Public errors omit observed team usage and
private target values. Withdrawal and all-mail behavior remain independent.

More than eight distinct live sources start with bounded first-page batches:
at most 128 sources and eight values per source. Full sources continue by keyset;
all prefetched raw rows are charged before continuations. Small source sets keep
the single-source queries, and neither path truncates the discovered set.

General fallback keeps mode resolution, discovery and its page in one snapshot.
Discovery bounds do not bound every later candidate/message/fallback cost;
those remain activation checks.

Address-filtered Team All Mail pages also use the optimized reader for
ViewedUpdated sorting when their filter does not inspect view history. A saved
view time overrides message recency. Sparse matches look up history by primary
key; dense pages merge viewed and never-viewed sources and refill in the same
snapshot. The same eligibility and competing-copy checks apply in every round.
Any later failure returns an error, never a partial page. Window sizes bound
emitted candidates, not all rejected source rows or timestamp ties; the existing
request deadline still applies. Other unsupported sorts and filters retain
General. The common `crm.team_email_read` span records sort and chosen path.

The optimized reader probes positive targets first, so sparse selections do not
require walking a record's entire mailbox history. In a selected page, each
candidate and competing-copy check expands its non-draft participants once and
reuses the complete set for inclusion and domain vetoes. An early matching
participant never hides a private participant later in the thread. This removes
duplicate message/recipient work; it does not cap the length of a thread or the
number of candidates. Per-thread eligibility keeps
only the bounded live target IDs and probes their indexed addresses or domains,
so it does not repeat that expansion for each thread. Selected-policy target
resolution fences mailbox contact and participant lookups. Company domains are
fenced by company ID before checking team membership, so stale estimates cannot
substitute a whole-team domain scan. Candidate contacts stream with `UNION ALL`;
duplicates only make the probe conservatively choose another stream, while the
page deduplicates thread IDs. Record probes and sparse pages reuse the shared
indexed sender/recipient branches, without adding
index maintenance to ordinary contact ingestion.
All-mail-only reads retain their existing candidate path. Ingestion has a
fifteen-second statement bound, including admission before enrichment, and
rechecks eligibility in the population transaction. These bounds do not change
which mail is eligible.

Population scans address history before locking the mailbox row. A non-locking
admission probe rejects stale work first; after the scan, a fresh `READ COMMITTED`
check locks the current primary mailbox and membership, then rechecks consent and
the queued generation before any CRM write. Disconnect, deletion, reauthentication,
loss of primary status or membership, and withdrawn/replaced consent invalidate
the scanned result. The row guards remain through commit. Shared team privacy and
per-address teardown locks still cover the scan and writes, preserving exclusion
and depopulation serialization without holding up mailbox sync for the history
scan. `crm.email_interaction_scan` and `crm.email_authority_recheck` distinguish the
two phases under `crm.email_eligibility`.

The scan also returns the two messages and matched contacts that supply its
dates and direction. After taking the authority guards, population validates
those facts with primary-key probes: mailbox/thread, dates, direction, draft and
provider-missing state, and sender/recipient address. Changed or deleted evidence
returns `Contended`, which the population worker retries later; the retry
rescans without a mailbox lock. `crm.email_history_witnesses` measures this bounded
check. It does not rescan a thread or freeze all mailbox history: messages added
or changed outside these witnesses retain the existing asynchronous population
and cleanup behavior.

A failed population (`Contended` included) is hidden on the CRM population
queue for 30 seconds doubling to 15 minutes, and given up after six attempts.
One refused its team's four population slots never waits for one: it is
hidden for 5 seconds doubling to an hour (`email::domain::crm_population`). A
policy history page (up to 100 contacts) is retried whole, up to 30
deliveries: its cursor has not moved, so the retry scans every contact of the
page again, and its writes are idempotent. Lock-wait contention already takes this path. Changed evidence adds
to it only when one of a contact's two witness messages changes between that
contact's scan and its guards, so a page is not expected to repeat for the same
contact.

Thread-exclusion controls and API writes are gated by the remote
`enable-crm-thread-exclusions` flag, off by default in every environment. The
web registry has no dev default or local override; the CRM domain independently
requires a successful enabled snapshot for the authenticated caller before
setting or clearing an exception. Missing flags, failed evaluations and service
constructions without the gate all refuse these writes. Other privacy settings
and existing exclusion enforcement remain active when the flag is off.

DSS and email-service binaries can briefly run different versions. An older
population binary ignores an existing exception row and may populate from the
excluded thread until that worker restarts with the new query. Older Team email
readers with an inlined eligibility rule also ignore thread exceptions; readers
that call the replaced SQL function and direct-access checks enforce its veto.
Keep the flag off until every ingestion and Team email reader binary is confirmed
to run the new code; creating or enabling the remote flag is a separate rollout
action. Rolling back an application binary preserves the SQL veto while the
migration remains applied, but restores these limitations in inlined readers and
population.

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
