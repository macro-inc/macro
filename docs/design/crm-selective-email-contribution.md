# Selective CRM email contribution

Status: implementation in phases. The product direction is direct agent
activation, whole-thread matching, live contact/company selectors and retained
CRM records after narrowing. Source observations are from `e417be81d6`.
The first phase supplies dormant storage and compatibility guards; selected
contribution must remain unavailable until every eligibility path is upgraded.

## Problem and scope

A member can currently contribute all eligible mail or none. Domain exclusions
cannot express “only these conversations, people, or companies.” Add a selected
consent mode whose inclusion rules the member or an agent acting as that member
can manage through the SDK. Existing all-mail consents remain unchanged. There
is no visual rule builder in v1 and no required member confirmation for each
agent activation. The member can inspect, edit or withdraw their rules anytime.

Contribution controls what a mailbox shares. CRM viewing is a separate
permission managed through the member-access API; client controls follow
separately. A member whose CRM viewing is off can still manage their consent
and private rules. Selected consent does not grant CRM or database viewing.

## Current behavior and constraints

- `crm_email_consent` is keyed by team/member and binds consent to the exact
  primary `email_links.id`. Mailbox lifecycle changes revoke it, including changes
  that retain the link ID. Leaving a team deletes consent. Opt-in covers past
  and future eligible mail and atomically enqueues `crm_email_backfill_outbox`.
- Team and personal domain blocks include dot-boundary subdomains. A blocked
  sender or recipient, including CC/BCC, in any non-draft message denies the
  whole contributed thread. Legacy company `email_sync = false` also denies.
- Owner-managed thread exceptions veto the contributor's exact mailbox copy.
  Their controls and API writes remain rollout-gated; stored exclusions are
  enforced independently of that flag.
- [The privacy contract](../CRM_EMAIL_PRIVACY.md) retains companies, contacts and
  prior interaction metadata after withdrawal. CRM reads use current privacy
  settings on the primary. Inbox ownership, explicit sharing and project grants
  remain separate access paths.
- There are **three implementations of eligibility** to keep equivalent:
  `crm_email_thread_allowed(team, thread)` for direct grants and scoped reads;
  `crates/crm/src/outbound/companies_repo/email_privacy/interactions.sql` for
  set-based ingestion; and the inlined Team reader in
  `crates/email/src/outbound/email_pg_repo/dynamic/query/team_scope.rs`.
  The Team reader deliberately avoids a scalar function call per mailbox thread.
- Scoped lists also depend on cheap candidate filters and planner fences before
  expensive privacy work. Preserve those boundaries: a previous per-thread
  privacy check made work grow with unrelated mailbox history.
- “Keep personal emails out” (`exclude_personal_emails`) gates personal-provider
  contact population. It is not a whole-thread deny predicate. Direct grants
  have additional external-participant and contact/parent visibility checks.
- Contacts hold every known address in `crm_contact_emails`; `crm_contacts.email`
  is the primary display address. Companies hold domains in `crm_domains`.

## Proposal

### 1. Format, matching and storage

Use a versioned OR-list of positive selectors, with no scripts, regular
expressions, arbitrary predicates, priorities or negation. A matching thread ID
or any sender/To/CC/BCC address in any non-draft message selects the **whole
mailbox-local thread**, including its eligible past and future messages and other
participants. Draft-only threads do not qualify. Explain this effect in settings,
SDK guidance and every mutation result.

```json
{
  "schema_version": 1,
  "include": [
    { "kind": "thread", "thread_id": "00000000-0000-4000-8000-000000000001" },
    { "kind": "address", "address": "person@example.com" },
    { "kind": "contact", "contact_id": "00000000-0000-4000-8000-000000000002" },
    { "kind": "domain", "domain": "example.org" },
    { "kind": "company", "company_id": "00000000-0000-4000-8000-000000000003" }
  ]
}
```

The rule definition is separate from the consent mode and grant. Parsing or
validating JSON grants nothing; the authenticated activation transaction changes
consent and its active revision.

| Selector | Meaning |
| --- | --- |
| Thread | Exact internal UUID in the contributor's primary mailbox. Reject provider IDs and another member's copy. |
| Address | Reuse contact normalization and its 320-byte limit; match exactly without stripping plus tags/dots or inferring aliases. |
| Contact | Match every current `crm_contact_emails.email` for the referenced contact in this team, including secondary addresses. Resolve live on reads and ingestion. |
| Domain | Normalize and validate a bare domain; match it and dot-boundary subdomains. Reject wildcards, public suffixes and personal-provider domains using maintained domain/provider classification. An individual address at a personal provider remains selectable. |
| Company | Match its current `crm_domains` in this team. Resolve live; do not expand through unrelated personal addresses of its contacts. |

Contact and company selectors **follow the record as it changes**. Adding or
removing an address/domain changes matching without a rule activation. A source
with no current targets matches nothing and carries a warning; it may match later.
Deletion, loss of record-level visibility or a move outside the team makes the
reference inactive. The contributor's CRM viewing preference alone does not
change an existing grant or its live matching. A rename does not retarget it.
A merge that deletes the old ID does not silently transfer consent to another
ID. The agent can replace the reference explicitly. Preserve existing
record/parent authorization checks.

Scope rules to `(team_id, user_id, link_id)`, never a team allowlist. Derive
member/team from authenticated receipts; reject those IDs in mutation bodies.
Mailbox replacement or reconnection requires a fresh explicit grant and current
validation, even when the old definition is retained for inspection. Do not move
thread selectors or automatically reactivate a prior policy.

Store immutable definitions in `crm_email_rule_revisions`, canonical JSON for
inspection, and five normalized target tables: `crm_email_rule_threads`,
`crm_email_rule_addresses`, `crm_email_rule_contacts`, `crm_email_rule_domains`,
`crm_email_rule_companies`. Their primary keys are
`(team_id, user_id, revision, target)`; the revision binds the mailbox. Contact and
company rows retain IDs, not address/domain snapshots. Missing source records
must not mutate historical definitions. Authorize targets in the domain service;
normalized rows and JSON come from the same validation result and cannot be
edited independently through an API.

The active consent pointer references that member's exact mailbox and revision.
Store actor history separately in `crm_email_policy_audit`. Membership/mailbox
cleanup removes private policy data without deleting shared CRM records.
Equality indexes serve target probes. Resolve live references once per bounded
candidate set, not by expanding JSON or scanning all CRM entities per thread.
Source-change reconciliation also needs indexed reverse reference lookups.

Initial authoring limits are assumptions: 64 KiB canonical stored JSON (including
separator spaces) and 500
selectors before deduplication. Reject unknown versions/fields, unauthorized or
missing IDs, invalid targets and an oversized request in full; never truncate
consent. Canonicalize/deduplicate without changing meaning. An empty selection
is valid and contributes nothing. Do not cap live expansions by silently dropping
addresses/domains; bound query and preview work instead. Measure pathological
records before rollout. Warn on the contributor's address, aliases or mailbox
domain because those may match nearly all mail; preserve their intended meaning.

Use compare-and-swap on the observed policy token. For modern rows it contains
`consent_incarnation`, `policy_version` and an opaque fingerprint of current
mailbox/membership authority. The incarnation is fresh for each consent row's
lifetime and immutable across updates; the database owns the version. Compare
these under the mailbox/membership and consent locks before a new mutation.
A missing row or changed incarnation, version or authority returns 409. Leaving
the team cascades consent; rejoining cannot reuse a prior modern token.

Inspection is always read-only, with the flag on or off. It must not create
consent, initialize an incarnation or transfer historical work. With the flag
on, legacy inspection returns an opaque fingerprint of the observed consent and
explicit mailbox/membership authority; with the flag off it returns legacy state
without an editable token. The first sharing mutation compares that legacy
observation under the existing locks, initializes a fresh identity while preserving
any existing grant, and atomically replaces unfinished legacy work with a complete
generation-bound history pass. This includes work already published out of the
legacy outbox. Withdrawal cancels unfinished work. All-mail members who only read
settings stay on the legacy worker path, even with the flag enabled.

Authority fingerprints cover link ID, owner/address/provider and credential-owner
identity, primary/deleting/disconnect/reauth state, grant ID/generation, team and
member keys, role and CRM access. They exclude sync activity, history/provider
cursors, timestamps, whole mailbox/member row versions, billing plan and seat
bookkeeping. Legacy consent alone uses its row identity because it lacks a durable
incarnation and has no sync writer. Modern tokens use incarnation/version instead.
Recheck the exact live mailbox and target authorization at submit: a currently
unhealthy, deleting, disconnected or non-primary mailbox cannot grant contribution.
A grant, ownership, role or access change requires a new observation; CRM access
denial still permits the member's own controls after that observation.

A transient reauthentication failure that clears on the same link and grant may
be accepted if consent itself did not change: the member's sharing intent still
applies. An active grant revoked during that interval changes policy version and
conflicts even after reauthentication clears. An absent-consent member who leaves
and rejoins with identical authority may use the same first-grant observation;
there is no previous consent to revive. No authority epochs or triggers are added
to mailbox or membership tables. Live contact/company edits do not conflict with
a policy token: their changing match sets are part of the grant. They invalidate
previews independently.

Scope idempotency keys and results to the incarnation and recheck that lifetime
before replay. A committed retry returns its recorded outcome without executing
any effect, marked as a replay rather than evidence of the current policy. A new
mutation carrying a stale token cannot recreate or initialize replacement consent.
Withdrawal remains available for existing consent while its mailbox is ineligible;
inspect its current token first. Never automatically refresh a conflict and replay
a sharing command.

A definition revision, policy version and `schema_version` are distinct.
Concurrent source edits do not rewrite the rule revision: preview results carry
a separate effective-context generation. Unknown future modes/versions fail
closed, never become all-mail. Incarnation storage and these guards are required
before the policy API ships; the API consumes them without migrating on reads.

**Alternatives rejected:** a team allowlist enrolls other people; snapshots fail
to follow the selected record; unversioned JSON loses safe replacement and audit;
version-only CAS can reuse a deleted consent's token; a generic expression
engine is harder to authorize, index and explain.

### 2. Precedence and the private-thread dependency

For each contributor's mailbox copy:

```text
live exact-primary mailbox + current membership + active consent
AND no team/legacy-company domain denial
AND no personal domain denial
AND no private-thread exclusion
AND (all-mail mode OR a live inclusion target matches)
AND any separately delivered contribution-cutoff restriction
```

Denials always win, including over an exact thread selector. One matching
participant selects the otherwise eligible thread; one denied participant
excludes it. A later message can change either outcome. Existing record/parent
authorization and personal-contact population gates still apply at their current
boundaries. Inclusion grants no new record visibility.

CRM viewing checks belong to the requester-side read boundary. Never add the
contributor's `crm_access` preference to eligibility: changing viewing permission
does not withdraw consent, deactivate rules or stop contribution.

Reuse the thread-exclusion dependency's
`crm_email_thread_exclusions(team_id, user_id, thread_id)` retaining `link_id`,
and `crm_email_thread_excluded(team, user, link, thread)`. Its mutations verify
mailbox ownership, take the exclusive `crm-email:{team}` lock and clean up on
membership/mailbox/thread deletion. Its owner-only list is keyset paginated;
set/clear remains an action on the existing privacy API. Reconcile with the
merged dependency before editing eligibility. Do not create a second exception
store. The veto must apply in the scalar function, ingestion and inlined Team
reader even if the exclusion feature's write flag is off. Future label/folder
vetoes belong to that dependency's target-specific predicates.

Keep “Keep personal emails out” as the team-controlled population gate: an
inclusion cannot force personal-contact creation, but the setting does not
promise to hide every mixed company/personal thread. A future date cutoff adds
a narrowing restriction and survives mode changes. Recommend excluding whole
threads with older non-draft messages unless that task implements real message
redaction. A “has a recent message” check exposes older contents. That task owns
the final timestamp contract; accept no speculative cutoff field here.

**Alternatives rejected:** inclusion-over-denial defeats privacy settings;
changing the personal-provider gate alters existing all-mail behavior; a recent
message alone cannot enforce a history boundary.

### 3. Consent, direct agent activation and member visibility

Retain all-mail and add selected consent. Suggested effect copy:

> Share full past and future email threads from this primary mailbox when a
> selected thread, address, contact or company domain matches. A matching
> participant shares the whole thread, including other participants. Contact and
> company selections follow their current addresses and domains. Exclusions still
> apply. Other members may contribute their own copies. Narrowing hides your
> ineligible contributions but keeps CRM records and prior interaction dates.

The member **or their agent acting as them** may activate/replace selected rules
and switch contribution mode directly. No saved approval, human-only credential
check or per-activation confirmation token is required. Existing authenticated
scope restrictions on sharing still apply; an agent cannot use a narrower
credential to escape its permissions. An admin cannot enroll or edit another
member. An autonomous agent identity manages only its own mailbox.

Rule, history, preview and consent methods use the same membership/own-mailbox
boundary as `/crm/email-privacy`; they remain reachable with `crm_access = false`.
Do not require a CRM-viewing receipt to inspect, edit or withdraw private rules.
Resolving CRM record details remains separately authorized. When details are
unavailable, show stored source IDs and the member's own literal rules instead
of resolving additional CRM names, addresses or domains through this exception.
Existing shared privacy lists keep their current contract.

The member's privacy settings show mode, exact mailbox, active definition,
current live targets when record access permits, warnings, applicable denials,
last change and its actor.
Provide a plain JSON editing surface with validation and a readable selector
list, plus immediate withdrawal. Link to owner-only, keyset-paginated history:
who changed what, when, the before/after definition and the resulting state.
Display live-source changes separately from agent rule replacements so a contact
edit is not falsely attributed to the last activating agent. Use existing
responsive settings patterns on mobile; no separate visual rule builder.

Record activation atomically with the revision, targets, consent and outbox.
Audit actor category (member, verified delegated agent, API credential, system),
verified agent/session provenance when available, timestamp, prior/new revision,
consent incarnation/version, consent wording version and outcome. Never trust an
actor ID supplied in a request body. Credentials with no verifiable agent attribution
are labeled API, not guessed to be human. Address-bearing definitions/history
are private settings; admins receive no other member's targets or previews.
Operational logs carry counts, revisions, timings and outcomes, not target JSON
or mail content. Return the active revision and effects to the agent immediately.

Mutations use the exclusive team privacy lock. Activation then takes the existing
mailbox/membership locks before consent/revision writes and rechecks primary
mailbox, connection, membership, target authorization and CAS in the transaction.
Withdrawal authorizes the caller's existing consent, membership and CAS without
requiring a connected or eligible primary mailbox. It remains immediate and
independent of a publisher's network lock.
Preview is optional and informational; a failed preview cannot turn a request
into all-mail. Future matching messages and live source changes are part of the
grant, not a frozen list approved by a preview.

**Alternatives rejected:** mandatory human approval blocks end-to-end agent
management; admin-owned rules violate individual consent; invisible agent edits
leave members unable to inspect or correct their contribution policy.

### 4. Retroactive effects and backfill

| Change | Immediate read effect | Historical work |
| --- | --- | --- |
| All-mail to selected | Unselected contributions disappear after commit. | Preserve unfinished eligible history; no new backfill is needed only if historical work is complete. |
| Off to selected; selected to all-mail | The explicit member/agent grant applies after commit. | Enqueue backfill atomically. |
| Add/replace rules | Read the new revision atomically, without an intermediate union. | Enqueue on potential expansion; treat mixed changes conservatively. |
| Remove rules; empty selection; withdraw | No-longer-eligible contributions disappear on subsequent primary reads. | Continue still-eligible unfinished work; only denied work may no-op. |
| Contact addresses/company domains change | Live references change matching immediately. | Durably reconcile affected active policies; additions enqueue bounded backfill, removals cannot preserve stale grants. |
| Add/remove private exception or domain block | Deny immediately; restoration still respects the active mode. | Reuse existing exclusion-removal scheduling. |

Keep sync-created companies/contacts, manual edits, source attribution and prior
interaction dates under the existing privacy precedent. These are historical
CRM metadata, not proof that mail remains readable. Future population computes
eligible interactions from current stored messages, not queued timestamps. This
is not a retroactive metadata scrub. Already downloaded mail cannot be recalled;
invalidate CRM list/detail caches on policy changes and fail closed on primary
errors. Live-record mutations also invalidate affected preview/context caches.

Use the existing `(team, member)` outbox and retry/idempotency mechanism. Carry
the claimed `(consent_incarnation, policy_version)` through publication, paged
historical work and completion; authorize against current state before enrichment
and again in the write transaction. Within the same incarnation, a stale version
alone must not discard unfinished eligible history. After narrowing, finish the
remaining scope with current eligibility or durably transfer it to the replacement
job before acknowledging/canceling the old one. Only now-denied work may no-op
without replacement.

A different or missing incarnation revokes the old job's authority. It cannot
adopt a newly created consent, enqueue work for it, or acknowledge/delete its
outbox request. Completion compares the claimed incarnation and generation so
an old worker cannot erase new work. A new grant schedules its own history.
Before activation, drain legacy unversioned work or durably replace its unfinished
eligible history through the current authorized scheduling path. Never attach
the current incarnation to an old job at consumption time.

Historical work walks raw mailbox contacts in pages of 100 through the existing
`(link_id, email_address)` index. Empty or ineligible contacts advance the cursor;
sent-capable contacts run first, then a second pass includes received-only
contacts. Every effect recomputes current eligible dates. Checkpoints compare
the captured generation, work ID, pass and address before publishing the next
page. A modern outbox row remains as a recovery signal, due again after 15
minutes if no page advances it; completion deletes only its exact generation.
Legacy history stays unversioned and may run only while consent identity is
null. New live-mail notifications are explicitly marked as reconciliation hints
and use current stored eligibility; they carry no historical grant. Initializing
a consent in the API phase must atomically schedule modern replacement history
before retiring legacy work. Rollout must drain old unmarked live notifications.

A source-record edit may affect many policies. Persist reconciliation work with
that edit, use indexed reverse references and bounded fan-out, and coalesce
backfills per member. Do not make one contact edit synchronously scan every
mailbox. Authorization always resolves live data; asynchronous reconciliation
only refreshes counts/history/population, never grants stale access. The worker
records one content-free `live_targets_changed` system audit entry per affected
member and event; retries neither duplicate that entry nor restart completed work.

Use application transaction hooks for contact address/parent edits, contact and
company hiding, hide cascades, and sync deletion. Probe the rule-target reverse
indexes before recording events; bulk deletion first checks for any team rule
references and preserves its existing SQL when there are none. Row triggers on
all CRM imports and enrichment were rejected after measuring per-row overhead.
New IDs cannot already be selected, and metadata-only changes do not change
matching. Direct SQL edits and future domain/address writers must use the same
transactional hook. Before activation, audit every live matching source, including
member role changes, and complete any missing event producers. Preview context
invalidation belongs with the preview API in 3c.

**Alternatives rejected:** destructive cleanup loses shared/manual work; future-
only rules leave old mail readable; canceling every stale job silently loses
eligible history; asynchronous allow caches delay privacy revocation.

### 5. Enforcement and performance evidence

Upgrade **all three eligibility paths** before activation. The scalar function
resolves exact consent/revision once and walks only the requested thread's
participants. Probe thread selectors first, then indexed addresses/domain
suffixes and live contact/company references. Even an exact thread match still
runs every veto. Never scan unrelated mailbox threads inside the function.

Ingestion gathers the address-filtered thread set, materializes participants and
suffixes once, and joins active rules, live references and exclusions set-wise
before aggregation. Retain pre-enrichment checks, in-transaction checks and the
shared/exclusive privacy locks. Never replace this with a scalar call per thread.

The inlined Team reader needs equivalent positive and negative joins over
candidates. Keep cheap mailbox/company/contact filters and planner fences in
scoped lists. Sparse selected feeds should enter through indexed positive target
candidates. Apply final eligibility **before** conversation deduplication,
cursor and limit. Do not prematurely cap candidates and omit eligible results.
The bounded discovery core lives in CRM and is injected into the email adapter.
It resolves each distinct live contact/company source once, retaining contributor
visibility separately from its values. The Team probe and page reuse the complete
contact result in the same snapshot. All-mail reads call neither discovery nor
admission and keep their existing SQL. This change adds no index or migration.

Choose the small-input strategy before live expansion: at most eight selected
contributors and 4,000 raw selector references. Exact-address policies use indexed
mailbox/address probes while the estimated cross product is at most 50,000;
beyond that threshold, use a bounded scan rather than reject a complete policy
for the choice of algorithm. Small domain policies use a bounded SQL aggregate;
larger inputs fold shared source values and stream mailbox contacts through
keyset pages. Up to eight distinct live sources retain their single-source reads.
Larger source sets start with indexed batches of at most 128 sources and eight
raw values per source; full first pages continue by keyset in pages of at most
2,048. Charge every prefetched page before any continuation, and shrink the batch
so its worst-case raw count fits the remaining allowance plus one sentinel.
Empty and singleton targets therefore avoid a separate roundtrip each without
truncating larger expansions. Both strategies use the following request-wide
limits:

| Work | Maximum |
| --- | --- |
| Selected contributors, including empty policies | 1,000 |
| Raw selector references | 50,000 |
| Address rows from distinct live contacts | 50,000 |
| Domain rows from distinct live companies | 50,000 |
| One live source value, before normalization/decoding | 4 KiB |
| Accounted literal/live source text | 8 MiB |
| Mailbox contact rows, including nonmatches | 250,000 |
| Mailbox contact text | 32 MiB |
| Domain suffix checks | 750,000 |
| Live-source membership checks | 250,000 |
| Discovery deadline, shared by its stages | 10 seconds |

These are synthetic-fixture budgets, not production distributions. Charge raw
rows before filtering/deduplication; share each source's allowance across all
contributors. Bound SQL input batches and stop after one sentinel row beyond the
remaining allowance. The small SQL aggregate can materialize the bounded raw
contact page before checking its byte count; 32 MiB is a text-work allowance, not
a claim about total database memory. Never return a partial contact set.

`validateRules` and `replaceRules` run the same admission checker against the
proposed replacement plus the team's other active selected policies. Validation
is read-only and does not reserve capacity. Replacement rechecks inside its
locked mutation before saving or granting; a refusal rolls back identity,
history transfer, audit and idempotency effects too. The member/agent receives
HTTP 400 naming the exceeded limit and maximum, without another member's usage
or rule content. They can narrow the rules and validate again; changing consent
to all-mail and withdrawal retain their independent paths.

Live changes can outgrow a previously admitted policy. A Team read then returns
HTTP 503 naming the limit, records `limit_hit` and work counts on its discovery
span, and returns no partial page or advanced cursor. That request fails for the
viewer; it must not silently omit one contributor or weaken an exclusion.
Withdrawal remains available even after overflow or when the flag is off.
This bounds discovery, not every later message/candidate/fallback query; retain
those separate activation gates.

| Query shape to measure | Required evidence |
| --- | --- |
| Direct thread PK → consent/revision → participants → target/veto probes | Allowed/denied/no-match, large thread, custom/generic plans; unrelated mailbox growth does not multiply buffers. |
| Scoped company/contact list → fenced eligibility → dedupe/keyset | First/deep pages, multi-address contacts, teammate copies, sparse/dense matching and function loop counts. |
| Inlined broad Team/Me feed | Mixed all/selected contributors, empty selections, 0/1/100% match density, cursor stability; no per-thread full-mailbox privacy work. |
| Ingestion by address → candidate threads → shared participants/live targets | Baseline/new buffers and throughput, multiple addresses for one contact, rules do not multiply a mailbox scan. |
| Live source edit → referenced active policies → paged reconciliation | Indexed reverse lookup, many policy references, no synchronous mailbox work, no missed concurrent edits. |
| Preview → bounded mailbox batches → current/proposed counts | No content retrieval, bounded memory/time, cancellation and honest partial counts. |
| Activation/lifecycle/outbox | Maximum rules, concurrent ingestion/withdrawal, lock order, legacy writes, no lost job generation. |

Assume 10k/100k/1m threads per mailbox, 10/100/500 selectors, 1/10/100
contributors, ordinary 5-message threads and a 10k-message outlier. Measure live
contacts/companies with 1/100/2,000 targets and a source referenced by many members.
These are synthetic stress points, **not measured production distributions**.
Compare fresh/stale statistics and custom/generic plans with statement timeouts.
Capture `EXPLAIN (ANALYZE, BUFFERS)`, p50/p95, rows filtered and loop counts on
private synthetic fixtures. Set absolute rollout budgets from the baseline.

Parity tests cover every selector, all/selected/empty states, sender/To/CC/BCC,
drafts, all vetoes, contact/company mutation/deletion/visibility, mailbox lifecycle
and stale backfill generations in the function, ingestion and inlined reader.
CRM viewing denial must preserve contribution and access to private rule controls.
Mutation/worker regressions cover deletion and rejoin with reused numeric
versions, initially absent consent, committed idempotent retries, and stale
completion after a new incarnation has queued work.
Performance approval must not rely on a tiny correctness fixture.

**Alternatives rejected:** materializing all allowed thread IDs requires mailbox-
wide maintenance; per-thread live expansion repeats the privacy-check failure;
caching allow decisions makes revocation eventual.

### 6. Multiple addresses and teammate copies

An address rule selects one address. A contact rule follows **all current**
addresses, including new aliases, and stops matching an address removed from the
record. Shared/recycled addresses are still addresses, not proof of person
identity. Settings and SDK guidance disclose the live set. Overlapping rules
count a thread once; removing one rule does not remove another match.

Each mailbox-local copy is independent. One member's private exception or missing
inclusion cannot suppress a consenting teammate's copy, including overlapping
messages. Deduplicate only among eligible copies. Direct access to a disallowed
thread ID cannot borrow a teammate's consent; the other copy uses its own grant.
Inbox ownership and explicit non-CRM sharing remain independent.

**Alternatives rejected:** primary-only contact matching misses known addresses;
cross-mailbox suppression would let one member revoke another's contribution.

### 7. Agent and SDK contract

Extend the privacy-settings SDK task in one `macro.crm.emailPrivacy` namespace,
using generated storage types and thin adapters over the CRM domain service.
Use entity handles for thread/contact/company selectors in public SDK methods;
UUIDs belong to the wire transport. Follow operation-category and generated-verb
registration conventions. Do not add a separate code-mode toolset.

| SDK method | Contract |
| --- | --- |
| `get()` | Caller-only consent/mode, exact mailbox, active definition and observed-state token. Always read-only. Read domain exclusions separately with `settings()` and private exceptions with `excludedThreads()`; creating target handles fetches no record details. |
| `validateRules(input)` | Authorize and canonicalize; return current live resolution, warnings and field errors. No grant and no mailbox content. |
| `replaceRules(input, {ifPolicy, idempotencyKey})` | Directly activate a validated replacement for the authenticated member using the exact opaque observation. Initialize legacy identity only in this mutation; return the new token, revision, audit event and whole-thread/live effects. No human approval token. |
| `previewRules(input, {ifPolicy, ifPreview})` | Start a bounded asynchronous comparison for the caller's mailbox, including before consent exists. Compare the observed policy and current preview slot; return a handle without initializing contribution. Repeat validation at activation. |
| `preview.get()` | Status, as-of time/context and distinct counts: current, proposed, added, removed, retained and denied; no IDs, subjects, participants or bodies. |
| `history()` / `revision.get()` | Owner-only fifty-event keyset history of actor, revision references, live-source events and resulting state; fetch one immutable definition separately. |
| Existing consent/domain/thread methods | Reuse the privacy-settings/exclusion APIs; modern mode transitions use the same CAS/audit domain path. |

Counts concern only the caller's mailbox-local copies. Denied counts are proposed
matches vetoed by exclusions; no teammate mailbox is inspected to deduplicate.
The API uses a read-only repeatable-read snapshot, raw timestamp/ID pages of 100,
a 10,000-raw-thread ceiling and a five-minute deadline from enqueue. Missing
matches and drafts advance the cursor. Each statement has at most 15 seconds,
limited further by the remaining deadline. Budget exhaustion returns explicit
partial/lower-bound counts, never an exact total. Progress has no thread IDs,
subjects, addresses or content. Cancellation and replacement fence late completions.

A separate poller runs counts so they cannot delay source reconciliation. A
matching edit invalidates the team's preview metadata in its existing transaction;
mailbox/member/consent changes are also detected through the authority observation.
Ordinary imports do not invalidate a stable as-of result. Enforce one new request
per member per thirty seconds and reuse identical retries; the retained slot ID
prevents a delayed start from resurrecting older work. Previewing writes only
bounded preview metadata, never consent or contribution/backfill work.

Publish routing/agent guidance through `DescribeCodeTools`/`ReadCodeDocs` and
`ExecuteCode`: agents may manage and activate rules directly, must explain past
and future whole-thread sharing and live references, must preserve overriding
exclusions, and report active only after the server commits. A request merely
to inspect mail is not a contribution instruction. Errors must not fall back to
all-mail. The SDK must not automatically refresh tokens and replay stale CAS
requests after a 409. Regenerate OpenAPI and SDK outputs; never hand-merge
generated files.

**Alternatives rejected:** a draft-only agent API prevents end-to-end management;
content previews reveal unnecessary mail; synchronous unbounded counts threaten
interactive latency.

### 8. Rollout and compatibility

Use remote `enable-crm-selective-email-contribution`, default **off**, including
dev until compatibility passes. The foundation defines its key without exposing
an activation path; later API/web wiring registers and evaluates it. Failed
loads refuse new activations. The flag controls new operations, never enforcement
of stored policies. Turning it off preserves selected restrictions, owner
inspection and withdrawal; it must never convert selected to all-mail.

Add `mode` defaulting to `all`, `selected_enabled` defaulting false, an active
revision and database-owned policy version to `crm_email_consent`. Legacy
`enabled` stays true **only for all-mail**. Selected uses false/true and an exact
owner/mailbox revision. Checks forbid mixed grants. Existing rows retain their
meaning; new policy tables start empty, with no migration backfill or consent
conversion. Modern responses expose effective enabled plus mode; old binaries
looking only at `enabled` fail closed.

Guard old `enabled=true` upserts on selected rows with an error requiring current
settings. Every old `UPDATE OF enabled=false`, even a no-op on the legacy bit,
revokes selected too. New selected activation disables legacy consent, then sets
selected state in the same transaction without naming `enabled` in the second
statement. An explicit modern selected-to-all operation clears selected state
and changes mode. The database version changes when the effective policy tuple
changes, fencing new CAS writes against old clients and lifecycle revocation.

That version fences updates only within one consent row's lifetime. Before
PR 3 exposes any modern policy mutation token, add `consent_incarnation` through a
forward migration and enforce one fresh, immutable identifier per row lifetime.
Keep legacy inserts compatible: a nullable column with guarded initialization
can avoid rewriting existing rows. Inspection returns a read-only legacy
observation. Only the first mutating request initializes a null incarnation under
the authorization locks after comparing that observation; preserve any existing
grant and transfer unfinished history atomically. Upgrade
idempotency storage, queued-work envelopes and completion checks together;
all must carry the incarnation before activation. Never edit an applied
foundation migration to add this support.

Mailbox lifecycle revocation clears both bits, retaining mailbox-before-consent
lock order without a new team advisory lock. An indexed exact-link update must
also find selected-only rows. Reconnection does not reactivate either mode.
Test real legacy upserts, no-op withdrawal and membership/mailbox cascades.

Deploy schema/guards and all three compatible eligibility paths before any
selected activation. Older readers may temporarily show no selected mail; old
workers may acknowledge without population, so **every worker must be upgraded**
before enablement. PR 3c teardown hooks can produce coarse `team` source events
that pre-3c workers cannot deserialize. The initial rollout is safe while saved
rule tables are empty. After activation, disabling the flag does not stop these
producers or make an old worker compatible: stop the new event producers and
drain their events with compatible workers before an old-binary rollback.
Older eligibility readers fail closed and need a later backfill repair; never
roll back schema/guards or widen consent to preserve old-binary visibility.
Keep stored restrictions enforced indefinitely.
Initial rollout also requires private-thread mutations to be available to the
same cohort, after both ingestion and the optimized Team reader are upgraded.

**Alternatives rejected:** reusing `enabled=true` for selected leaks through old
readers; deployment ordering without guards cannot protect rolling clients;
flag-off-as-all-mail turns a rollout control into a disclosure.

### 9. Independently shippable PR sequence

1. **Dormant foundation and revised design.** Typed rule format, empty revision/
   target/audit tables, additive consent fields, legacy-write/version/lifecycle
   guards and the default-off key. Test existing consents and old writers. No
   activation API or eligibility edits. This phase does not require eligibility
   changes; the following phase depends on the merged thread-exclusion contract.
2. **Eligibility and live resolution.** After PR 1 **and merged
   [thread exclusions](https://github.com/macro-inc/macro/pull/10836)**,
   update `crm_email_thread_allowed`, set-based ingestion and the inlined Team
   reader together, plus compatible consent readers. Reuse its veto, add indexed
   live-target joins/reverse references and parity/performance evidence. Still
   expose no selected activation. The migration asserts that no selected-mode
   consent exists before replacing the function, making the old-inline-reader
   deployment assumption executable. The Team reader retains its shared
   ten-second deadline; ingestion admission and rechecks use a fifteen-second
   statement timeout. Sparse policies probe positive targets before record
   history; live domains resolve against scoped mailbox contacts once
   per page, and fenced participant lookups reuse existing indexes. Resolve
   contribution modes inside the Team snapshot, including General fallbacks.
   Optimized all-mail-only pages keep their existing SQL without selected-rule
   work; General retains its scalar page SQL. Test both directions
   of a concurrent mode change across resolution, probe and page.
   Base new migrations after the latest merged
   dependency; never change an applied migration.
3. **Policy API and historical work, in three ordered PRs.** All remain dormant
   until the last stage is deployed and the default-off flag is enabled after
   the PR 5 gates and explicit rollout authorization.

   - **3a: storage and repository contracts.** Add nullable consent incarnation
     with guarded initialization/immutability; stamp audit, idempotency, preview
     and durable work with incarnation/version. The repository can initialize
     a disabled row only with an eligible primary; the API reserves initialization
     for a first mutation, never inspection. Old modern tokens never initialize. Store one replaceable preview and historical-work slot per
     member, retaining tiny start receipts through the applicable mailbox/member
     lifetime to reject delayed starts after replacement or completion, plus
     durable source events and bounded reverse-reference indexes on saved contact/company rule targets. No API, worker wiring, hot email-table
     index, existing-consent conversion or historical mailbox scan.
   - **3b: generation-safe historical and live-source work.** Carry the captured
     incarnation/version through enqueue, publication, pages and conditional
     completion; reauthorize before enrichment and population. Drain or replace
     legacy unversioned work. Commit one source event with each relevant record
     change and reconcile raw references in bounded pages, checking active
     consent after paging. Preserve unfinished eligible history when narrowing.
     Demonstrate unchanged all-mail backfill behavior and throughput.
   - **3c: own-member and agent APIs.** Add validation, CAS/idempotency, verified
     audit provenance, direct activation and bounded asynchronous count preview.
     Keep private controls independent of CRM viewing. Regenerate OpenAPI/storage
     SDK outputs and record SDK coverage deferrals. Replace the dormant
     `PopulateCrmPolicy` email E2E deferral with a full-stack generation/retry
     scenario before activation. Refuse activation on a false
     or unavailable flag; stored restrictions, inspection and withdrawal remain.
     Close the first-activation/bulk-deletion race before exposing activation:
     lock and revalidate live targets, and make teardown observe references
     committed while it waited for source rows. The dormant worker's early
     no-reference shortcut and same-statement deletion/reference snapshot do
     not provide that guarantee. Do not hold the team privacy lock through bulk
     teardown: its existing long cascades would delay or fail withdrawal. Keep
     plain deletes when the initial reverse-index probe finds no references; a
     fresh post-delete probe emits one coarse team reconcile event if first
     activation appeared meanwhile. Return IDs only on the referenced branch,
     and probe their references in a new statement. Measure both branches on the
     10,000-contact seed with fresh and stale statistics.

   Merge 3a, then 3b, then 3c. These depend on PR 2 and confirmed reader/ingestion
   compatibility. The unmatched discovery bound and million-thread mailbox tier
   remain required PR 5 activation gates, not substitutes for these contracts.

4. **SDK and member settings.** Split delivery into SDK wrappers and an approved
   UI change. The SDK exposes read/validate/replace/preview/history/withdrawal,
   existing consent/domain/thread controls, generated contracts and code-mode
   guidance in `macro.crm.emailPrivacy`; existing team-domain methods stay on
   `macro.crm`. Policy writes carry exact tokens and caller-owned retry keys.
   Prepare readable rules, JSON edit, counts, history and withdrawal as a desktop
   and phone proposal grounded in the existing privacy rows; implement the UI
   only after approval. Keep the server gate unchanged and default-off. Depends
   on PR 3; regenerate storage SDK conflicts.
5. **Rollout hardening and readiness.** Integration/parity/performance tests,
   mixed-version drills, mixed sparse/dense policies across contributors,
   concurrent source edits/backfill recovery, flag-off and
   rollback checks, connected runtime traces, operational counters and rollout
   runbook. Measure the
   **1m-thread mailbox tier before activation**, including sparse selections,
   large live targets and fresh/stale custom/generic plans; the eligibility
   phase does not establish that tier's budget. Bound work examining unmatched
   live addresses/domains and mailbox contacts before activation: a 99-selected-
   mailbox seed with about 2,000 live addresses per contact required 198,297
   address probes, 740,236 shared buffer accesses and 2,522 temporary blocks
   written by the original eager-distinct probe (1.55 seconds; 4.45 seconds for
   the request).
   The shared discovery core and authoring admission above address that
   expansion; measure its final Rust/API path and small/folded crossover before
   declaring this gate complete. The initial final-path capture alternated
   1,120 reads across fresh/stale custom/generic plans and 1/4/8/16/100
   contributors. All 560 bounded reads completed; the original expanded-policy
   path timed out at ten seconds in all 16 runs with 100 contributors, while
   the bounded path took 436–447 ms. Paired successful reads returned identical
   ordered IDs. Small literal/contact policies stayed near parity; one expanded
   contact added 4–9 ms. The smaller fixture also exercised 2,880 authenticated
   in-process API requests, including validation and replacement admission.
   These timings exclude HTTPS. A separate corrected 500-target shared/disjoint
   matrix completed 512 final-path reads without errors. Batched first pages
   reduced stale eight-contributor empty-contact reads from about 4.4 seconds to
   33 ms; fresh single-contributor singleton-contact cells added 5–24 ms. All 96
   first-page plans used the existing source indexes (0.158–2.772 ms). Full first
   pages still continue individually; these plans do not establish throughput
   for thousands of full sources. Another 2,048 authenticated API requests all
   succeeded: company-domain admission took roughly 232–288 ms for validation
   and 246–307 ms for replacement, including its existing locks. That API fixture
   retained 299,106 mailbox contacts but omitted thread/message history, and its
   stale profile covered source/rule growth with fresh mailbox-contact statistics.
   An overflow must never authorize a truncated
   target set, and falling back to a dense record stream is not a sufficient
   bound. The initial million-thread baseline used five million primary-mailbox
   messages with 2.905 million background messages; the full ten-million
   background tier remains required before activation on a quieter host.
   Selectivity-dependent plans and index-only probes may change at that tier.
   The General reader now keeps mode resolution, discovery and the scalar page
   in one read-only snapshot, including initially all-mail requests. Its tests
   cover both mode transitions, live-source changes after discovery, and
   next-request withdrawal and thread exceptions. Optimized selected pages reuse
   a complete participant set for inclusion and domain vetoes, avoiding a second
   message/recipient expansion when both need participants. This does not bound
   long threads or dense fallback work. Bound later candidate/message/recipient/fallback
   work before activation; discovery alone does not establish those properties.
   ViewedUpdated record pages now use the optimized reader: sparse matches
   look up saved views by primary key, while dense pages merge viewed and
   never-viewed sources and refill within the same snapshot and deadline.
   Saved view times override newer mail; competing-copy priority and every
   privacy veto remain cursor-independent. This does not bound rejected source
   rows, timestamp ties or every unsupported General shape. Retain the
   deterministic all-mail/selected snapshot-transition regressions added in
   PR 2 and the full-page ViewedUpdated parity tests.
   CRM-scoped email search is deferred: email search rejects CRM filters with
   HTTP 400 and reads no team mail. **If CRM-scoped search ships before selected
   activation**, it becomes a fourth contribution reader and must enforce the
   same consent, selected-rule and thread-exclusion eligibility as
   `crm_email_thread_allowed`, with a cross-reader parity test before activation.
   This worker phase adds no search code.
   Depends on all prior PRs. Enabling flags or deployment requires separate
   authorization.

## Remaining implementation questions

No further product decision is required to begin the foundation. Verify actual
mailbox/rule/live-target distributions before setting rollout budgets; the sizes
above are assumptions. Credential provenance and SDK names are now defined by the own-member API
and `macro.crm.emailPrivacy`. None requires a member-only approval
capability. The separate cutoff and CRM-access projects retain ownership of
their product boundaries.
