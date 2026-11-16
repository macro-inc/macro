# Selective CRM email contribution

Status: proposed; design only. Implementation requires approval and the separate
thread-exclusion delivery. Source observations are from `87eb481d5d`.

## Problem and scope

A member can currently contribute all eligible mail or none. Domain exclusions
cannot express “only these conversations, people, or companies.” Add a selected
consent mode whose inclusion rules a member's agent can prepare through the SDK.
Keep existing all-mail consents unchanged and provide no visual rule builder in
v1. A small review and confirmation surface is required even without a builder.

Contribution controls what a mailbox shares, not who can use CRM. Restricting
some team members from CRM or databases is a separate authorization project.
Members with CRM access can use records without contributing mail. Admins and
owners can manage that access through the member-access API; client controls
follow separately. This proposal must not imply that selected consent provides
a restricted member role.

## Current behavior and constraints

- `crm_email_consent` is keyed by team/member and binds consent to the exact
  primary `email_links.id`. Mailbox lifecycle changes revoke it, including changes
  that retain the link ID. Leaving a team deletes the consent. Opt-in covers past
  and future eligible mail and atomically enqueues `crm_email_backfill_outbox`.
- Team and personal domain blocks include subdomains with a dot boundary. Any
  blocked sender or recipient, including CC/BCC, in any non-draft message denies
  the entire contributed thread. Legacy company `email_sync = false` also denies.
- [The privacy contract](../CRM_EMAIL_PRIVACY.md) retains companies, contacts and
  past interaction metadata after withdrawal. CRM lists and direct CRM grants
  enforce current exclusions on primary-database reads. Inbox ownership, explicit
  sharing and project grants remain separate access paths.
- `crm_email_thread_allowed(team, thread)` is the read-side eligibility authority.
  Ingestion deliberately uses the set-based equivalent in
  `crates/crm/src/outbound/companies_repo/email_privacy/interactions.sql`, with
  parity tests. It does **not** call the function for each historical thread.
- CRM listing in `crates/email/src/outbound/email_pg_repo/dynamic/query.rs` fences
  cheaply filtered candidates with `OFFSET 0` before the function call, then
  deduplicates teammate copies and applies the cursor/limit. Removing that fence
  can charge a participant privacy scan for every thread in each team mailbox.
- “Keep personal emails out” (`exclude_personal_emails`) currently gates
  personal-provider contact population in `companies_repo.rs`. It is not a
  whole-thread deny predicate in `crm_email_thread_allowed`. Direct grants also
  have external-participant and contact/parent visibility checks. Preserve these
  distinctions; inclusion never overrides them.
- Contacts have several addresses in `crm_contact_emails`; `crm_contacts.email`
  is only the primary. Companies have domains in `crm_domains`.

## Proposal

### 1. Format, matching and storage

Use a versioned, declarative OR-list of positive selectors. No scripts, regular
expressions, arbitrary predicates, priorities or negation. A rule selects a whole
mailbox-local thread when its ID matches or any sender/To/CC/BCC address in any
non-draft message matches. The selection includes that thread's eligible past
and future messages, including messages with additional participants. Draft-only
threads do not qualify. Review copy must explain this whole-thread effect.

```json
{
  "schema_version": 1,
  "mode": "selected",
  "include": [
    { "kind": "thread", "thread_id": "00000000-0000-4000-8000-000000000001" },
    { "kind": "address", "address": "person@example.com" },
    { "kind": "contact", "contact_id": "00000000-0000-4000-8000-000000000002" },
    { "kind": "domain", "domain": "example.org" },
    { "kind": "company", "company_id": "00000000-0000-4000-8000-000000000003" }
  ]
}
```

This is authoring input. Validation returns a canonical, immutable draft with
resolved targets, its hash, base revision and mailbox link ID. Confirmation
activates exactly that draft, never re-resolves it silently.

| Selector | Recommended v1 meaning |
| --- | --- |
| Thread | Exact internal thread UUID owned by the member's consented primary mailbox. A provider thread ID or another member's copy is invalid. |
| Address | Trim and lowercase a valid mailbox address. Do not strip plus tags/dots or infer aliases. Match exactly. |
| Contact | Resolve every current `crm_contact_emails.email` for an authorized contact in this team into an address snapshot. Show all addresses before confirmation. Reject an empty expansion. |
| Domain | Reuse domain normalization/validation; match the domain and dot-boundary subdomains. Reject wildcards, public suffixes, malformed and personal-provider domains using maintained domain/provider classification. An address remains selectable at a personal provider. |
| Company | Resolve its current authorized `crm_domains` into a domain snapshot. Do not expand through contacts' unrelated personal addresses. Reject an empty or invalid expansion. |

Snapshots are intentional: adding an address to a contact or a domain to a
company must not silently widen somebody else's mailbox consent. Removal,
rename, reassignment, merge or deletion of the source record does not rewrite a
confirmed snapshot either. Its saved targets remain effective until the member
replaces it; a refresh is a newly reviewed draft. Warn when the source has
changed or disappeared. Record visibility changes can still narrow CRM access
through existing authorization. Reject live contact/company joins in the hot
predicate: they both widen consent without confirmation and add query cost.

Scope rules to `(team_id, user_id, link_id)`, never a team policy writable by an
admin. Teams retain their shared denials. Reject user/team IDs in mutation bodies;
derive them from authenticated receipts. Reconnecting or changing the primary
mailbox requires new consent and a newly validated draft; do not transfer thread
IDs or reactivate old snapshots automatically.

Store drafts and immutable approved revisions in CRM-owned tables, linked to
consent/membership, with an active revision pointer. Store canonical JSON for
review and audit, and normalized target rows for execution: separate thread,
address and domain tables keyed by `(team_id, user_id, revision, target)`, with
mailbox identity bound through the revision. Use equality indexes for those
keys; use enumerated domain suffixes to probe domain targets. Do not run JSON
array expansion or contact/company resolution per thread. Write the revision,
normalized targets, activation audit and outbox in one transaction. The JSON
and normalized rows come from the same canonical validation result; neither is
independently editable. Private exceptions use the dependency's store below,
not negative entries in this JSON.

Initial limits are assumptions: 64 KiB canonical JSON, 500 authoring selectors,
2,000 distinct expanded targets across all kinds, 100 addresses per contact and
100 domains per company expansion. Enforce both pre-expansion and post-expansion
limits and reject the entire request on overflow; never truncate consent. Reject
unknown fields/versions, unauthorized or missing IDs and invalid targets; return
field errors only within the caller's authorized scope. Canonicalize and dedupe
without changing meaning. An empty selected ruleset is valid and contributes
nothing. Validation warns when a target matches the contributor's own primary
address, known aliases or mailbox domain: participant matching can select nearly
the entire mailbox. Preserve the match, never silently discard the contributor.
Compare-and-swap `base_revision` rejects concurrent replacements with
409; identical retried draft/activation requests are idempotent. Version 1 is a
wire schema version, distinct from the monotonically increasing policy revision.
Unknown future versions fail closed, never become all-mail.

**Alternatives rejected:** a team allowlist lets one member enroll another;
unversioned JSON loses safe review/concurrency; live entity selectors silently
expand consent; a generic expression engine is unnecessary for the requested
three forms of inclusion and harder to index and explain.

### 2. Precedence and the private-thread dependency

For each member's mailbox copy, the contribution predicate is:

```text
live exact-primary mailbox + current membership + active consent
AND no team/legacy-company domain denial
AND no personal domain denial
AND no private-thread exclusion
AND (all-mail mode OR at least one confirmed inclusion target matches)
AND any separately delivered contribution-cutoff restriction
```

Existing record/parent authorization and personal-contact population gates still
apply at their existing boundaries. Inclusion grants no new record visibility.
Denials always win over a thread, address or domain inclusion; there is no
“force include.” Matching one participant includes the whole otherwise eligible
thread, but one denied participant excludes it. A later message can therefore
make a previously eligible thread private, or make an unselected thread match.
Evaluate against current stored messages on reads, not a cached allow decision.

The private exception **must reuse** the thread-exclusion delivery's intended
contract: `crm_email_thread_exclusions(team_id, user_id, thread_id)` retaining
`link_id`, and `crm_email_thread_excluded(team, user, link, thread)`. Its mutations
verify mailbox ownership, take the exclusive `crm-email:{team}` lock and clean
up with membership/mailbox/thread deletion. Its owner-only listing is keyset
paginated; setting/clearing a thread is an action on the existing privacy API.
These names reflect that worker's proposed contract, not shipped code at this
base. Reconcile to its merged API before implementation. Reuse the predicate in
both the scalar function and set-based ingestion; do not introduce a second
exception table. Future label/folder exclusions belong to that delivery's
specific predicates, and must also dominate inclusions.

Keep “Keep personal emails out” as the existing team-admin-controlled population
gate. A selected personal address cannot force personal-contact creation while
it is on. It does not currently guarantee that mixed company/personal threads
are hidden, and the review must not claim otherwise. Making it a whole-thread
deny would be a separate behavior change affecting existing all-mail users.

A future date cutoff must be an additional narrowing restriction, never an
inclusion and never reset by switching mode. Recommend whole-thread exclusion
when any non-draft message precedes the cutoff, because opening a thread exposes
its older messages too; a “has one recent message” test leaks older history.
The cutoff task owns the final timestamp and thread/message contract. Until it
ships, all available history is in scope and no cutoff field is accepted here.

**Alternatives rejected:** inclusion-over-denial defeats existing privacy
controls; denying every personal-provider participant changes all-mail behavior;
a recent-message cutoff without redaction does not enforce a history boundary.

### 3. Consent, confirmation and audit

Retain all-mail consent and add a distinct selected grant. Suggested copy:

> Share the full contents of past and future email threads from this primary
> mailbox that match these selections with your team's CRM. A matching person
> or domain shares the whole thread, including other participants. Team and
> personal exclusions still apply. Other members may contribute their own copies.
> Changing this selection hides your no-longer-eligible contributions but does
> not delete CRM records or previously recorded interaction dates.

Show the exact mailbox, mode, canonical targets grouped by selection, expanded
contact addresses/company domains, applicable exclusions, any implemented cutoff,
and old-to-new counts. Counts are informational, not a frozen list of future
messages. Include all targets in an expandable review, not just a truncated
summary. Carry self-address/alias/domain warnings into this saved confirmation
and show the preview's coverage counts so a broad selection is apparent. On
mobile use the same responsive settings dialog/review with scrolling
and an explicit confirmation button. No graphical condition editor is needed.

Only the member may activate a revision for their own mailbox. Their delegated
agent may read, validate, preview and save drafts acting as that member; an admin
cannot grant consent, edit rules or approve for another member. A standalone
agent identity can only manage its own mailbox. All active rule replacements,
including all-to-selected, require member confirmation in v1. Withdrawing consent
remains immediately available to the member without a preview or backfill wait.
Private exceptions retain the dependency's existing mutation permissions.

Use a server-owned review bound to member, team, exact mailbox, base revision,
draft hash and expiry (24 hours). Activation comes from the member's authenticated
review surface, with a server-verified approval, not an SDK `confirmed: true`,
model-generated quote or arbitrary bearer-supplied approval claim. All delegated
agent credentials, including ordinary unscoped sessions, must fail activation without that member-only approval. `agent_correlation`'s sharing
restrictions are an additional check, not proof of human approval: unscoped
requests currently pass `may_share()`. Enforce the approval boundary for every
adapter, including legacy `SetConsent(enabled=true)` and selected-to-all
transitions, so an agent cannot fall back to all-mail to bypass review. Existing
member-driven all-mail consent remains available. If the saved-review framework
cannot enforce that principal distinction, building it is a prerequisite, not
permission to accept agent self-approval. The current email privacy handler
itself does not provide this new confirmation contract.

Bind approval to a policy context version covering blocks, exceptions, mailbox
lifecycle and any cutoff; reject a changed context or stale base revision and
show a refreshed review. Live mailbox contents can change after preview; consent
explicitly covers future matching threads. Confirm under the existing exclusive
team privacy lock, then mailbox/membership locks before consent/revision writes,
following existing lock order. Recheck ownership, membership and connection state.

Keep an append-only revision/decision trail: actor, delegated session when
present, timestamp, previous/new revision, canonical hash, approved targets,
consent wording version and approval outcome. Owners can read their history;
team admins do not get private targets or previews. Protect address-bearing
snapshots like private settings, cascade them on membership/account deletion,
and retain no email subjects/bodies. Log only counts, revisions, timings and
outcomes in operational telemetry, not target addresses/domains or JSON bodies.

**Alternatives rejected:** direct agent activation makes review unenforceable;
admin-managed inclusion breaks individual consent; confirming only the first
opt-in leaves later expansions unapproved. A visual builder is unnecessary,
but removing the confirmation surface is not an acceptable shortcut.

### 4. Retroactive effects and backfill

| Change | Immediate read effect | Historical work |
| --- | --- | --- |
| All-mail to selected | Only the new matching, non-denied contribution remains readable through CRM after commit. | No new backfill is needed only when prior historical work is complete. Otherwise preserve unfinished work under current eligibility, or durably schedule its replacement. |
| Off to selected; selected to all-mail | New grant is effective after explicit confirmation. | Enqueue backfill atomically with activation. |
| Add/replace rules | Reads use the new revision atomically, with no intermediate union. | Enqueue if potentially expanding. Treat mixed replacements conservatively as expanding. |
| Remove rules; select nothing; withdraw | No-longer-eligible contributions disappear on subsequent primary reads. | Continue unfinished work that is still eligible; no-op only work now denied. Do not wait for publisher locks. |
| Add/remove private exception or domain block | Deny immediately on subsequent reads; restoring eligibility respects the active mode. | Reuse existing exclusion removal backfill scheduling. |

Do not delete or hide sync-created companies/contacts, remove manual edits, or
purge source attribution solely because a rule narrowed. Preserve prior
interaction dates by the existing privacy precedent; they are historical CRM
metadata, not proof that the corresponding mail is still available. Future
population computes eligible interaction ranges from current stored messages;
it must not trust queued timestamps. Do not promise a complete retroactive
metadata scrub. An already downloaded message cannot be recalled; invalidate
CRM list/detail caches after a privacy mutation and fail closed on primary errors.

Carry the desired policy revision through the outbox and paged historical
workflow for coalescing/cancellation, but always authorize against current state.
Use the existing `(team, member)` outbox and retry/idempotency mechanism, not a
second queue. Coalesce changes to the latest desired revision. Bound fan-out in
keyset pages; recheck before metadata enrichment and in the write transaction.
A stale revision alone must not discard unfinished historical work. After any
narrowing, including all-mail to selected, an existing job finishes its remaining
scope against current eligibility. If it must restart, durably transfer that
unfinished scope to the latest generation before acknowledging/cancelling the
old job. Only work no longer eligible may no-op without replacement, including
after withdrawal or an empty selection; a job must never restore a revoked rule.
Verify a mid-backfill narrowing where the remaining selected contact has not yet
been populated. Ensure a newer outbox request is not erased by completion of an
older job; compare the claimed generation when completing it. Withdrawal must
remain independent of a publisher holding a network request's row lock.

**Alternatives rejected:** destructive record cleanup loses shared/manual work;
recomputing every historical interaction date adds a separate provenance project;
only applying rules to future ingestion leaves existing mail readable.

### 5. Enforcement and performance evidence required

Extend `crm_email_thread_allowed` with indexed active-revision target probes and
the dependency's exclusion predicate. Resolve consent/mailbox/revision once.
Walk only the requested thread's non-draft participants; match thread IDs first,
then normalized addresses/domain suffixes. Hard denials still apply even on an
exact thread match. Never scan the contributor's mailbox, all company domains,
or all contact records inside this scalar function.

Extend `interactions.sql` with the same semantics as set-based joins: gather the
address-filtered thread set, materialize its participants and suffixes once,
join active rules and exclusions once, then aggregate eligible interactions.
Retain shared/exclusive privacy locks and the existing pre-enrichment and
in-transaction checks. Add parity fixtures for all/selected/empty, every selector,
mixed participants, draft-only mail, stale revisions and exclusion changes.
Do not regress ingestion into a loop calling the scalar privacy function.

For listings, keep cheap company/contact/mailbox filters and the existing planner
fence. Add selected-mode positive target semijoins in the candidate stage so a
sparse selection can use thread/address/domain indexes instead of invoking the
full privacy function on an entire team-wide feed. Apply final eligibility
before conversation deduplication, cursor and limit. A bare fence alone does
not bound a broad Team feed; measure that case separately. If domain inclusion
cannot use existing participant indexes, add a normalized mailbox/address/domain
lookup index in a separately reviewed migration, not a per-thread mailbox scan.
Do not prematurely limit candidates and return underfilled or missing pages.

These are query shapes to measure, not SQL shipped by this document:

| Shape | Required evidence before enabling selected consent |
| --- | --- |
| Single direct thread grant: thread PK → exact consent/revision → participants → indexed rule/exclusion probes | `EXPLAIN (ANALYZE, BUFFERS)` for allowed/denied/no-match and very large threads; no scan of unrelated mailbox threads. |
| CRM company/contact list: indexed address/domain candidates → fenced eligibility → dedupe → keyset/limit | First/deep pages, multi-address contacts, many teammate copies, 0/1/100% selection density; count function loops and verify fence remains effective. |
| Broad Team/Me feed with selected contributors | Positive-target candidate joins scale with matching mail, not a scalar check for every mailbox thread; test mixed all/selected contributors and cursor stability after withdrawal. |
| Ingestion for one address: indexed matching messages → grouped threads → shared participants/targets/denials → aggregate | Compare current and new plans and buffers; rule count does not multiply a full-mailbox scan. Include several addresses resolving to one contact. |
| Preview: mailbox-bounded keyset batches → current/proposed eligible thread IDs → set counts | No content retrieval, bounded batch memory/time, no synchronous unbounded count transaction. |
| Rule activation and outbox claim | Maximum target count, concurrent ingestion/withdrawal/lifecycle changes, lock order, short transaction and no lost outbox generation. |

Assume 10k/100k/1m threads per mailbox; 10/100/500 selectors; 1/10/100
contributors; ordinary 5-message threads plus a 10k-message outlier. These are
synthetic stress points, **not measured production distributions**. Test 2,000
expanded targets, overlapping rules, dense blocks and large company directories.
Hold the tested thread fixed while growing unrelated mailbox history tenfold:
direct-check buffers/work must not grow proportionally. Capture existing versus
proposed p50/p95, buffers, rows removed, function loops and batch throughput on a
production-size synthetic local fixture. Establish absolute latency/lock budgets
from the measured baseline before rollout; do not claim a performance pass from
this design. No dev or production data was accessed for it.

**Alternatives rejected:** materializing every allowed mailbox thread requires
mailbox-wide maintenance and risks stale grants; per-thread entity expansion
repeats the prior privacy-check failure mode; asynchronous authorization caches
cannot provide immediate revocation.

### 6. Multi-address contacts and teammate copies

An explicit address selects only that address. A contact selection expands all
of its currently known addresses, not just the primary. Different rules matching
the same thread count once. Removing one rule does not hide a thread still
matched by another, unless an exclusion wins. Contact enrichment never grows the
approved snapshot. Shared/recycled addresses remain addresses, not verified
person identity; disclose them in the confirmation.

Evaluate each mailbox-local copy independently. A private exception or missing
inclusion for one member does not suppress another consenting member's copy,
even when messages overlap. Listing deduplication must choose only among copies
that passed eligibility; a disallowed own copy cannot shadow an allowed teammate
copy. Direct access to the disallowed thread ID cannot borrow the teammate's
consent; access to the other copy uses its own grant. Owner inbox and explicit
non-CRM sharing remain independent. No cross-mailbox exception propagation or
message-level redaction is introduced.

**Alternatives rejected:** primary-address-only selection misses known aliases;
conversation-wide suppression lets one contributor revoke another's consent and
would require a new cross-mailbox identity and governance policy.

### 7. Agent and SDK contract

Extend the privacy-settings SDK work under one `macro.crm.emailPrivacy`
namespace; settle final method names with that delivery. Continue using generated
storage API types and the CRM domain service behind thin HTTP adapters. Public
SDK methods take and return entity handles: thread/contact/company selectors use
their handles, and drafts/previews get handles with operations on them. The JSON
above is the wire format; UUIDs stay inside the transport. Tag methods with their
SDK operation category and register generated-method verbs. Do not add a
parallel toolset or a second privacy settings client.

| Proposed method | Contract |
| --- | --- |
| `get()` | Caller-only consent mode, mailbox, active revision/rules and applicable exclusions; use the dependency's pagination for private exceptions. |
| `validateRules(input)` | Authorize/normalize/resolve; return canonical draft material, expanded targets, warnings and validation errors. No activation or mailbox-content reads. |
| `saveRulesDraft(input, {baseRevision})` | Persist an immutable draft with idempotency key; return a draft handle with hash/expiry and review destination. This is the agent's write operation. |
| `draft.preview()` | Start a bounded asynchronous comparison for the caller's mailbox; return a preview handle, no content. |
| `preview.get()` | Status, as-of time, policy revision and distinct contribution counts: current, proposed, added, removed, retained and denied. No thread IDs, subjects, participants or bodies. |
| `draft.presentReview()` | Present/link the saved member review; return pending/confirmed/rejected/expired and resulting revision. Never approve it. |
| Existing withdrawal/domain/thread methods | Reuse the privacy-settings and thread-exclusion APIs and their authorization. |

Counts describe the caller's contribution copies, not how many conversations
will disappear for every teammate. Denial reason counts may overlap and must
say so. Counts must not inspect another mailbox to “deduplicate” the preview.
Use a bounded asynchronous scan with progress, cancellation and a proposed
five-minute job budget; return explicitly partial/lower-bound counts on timeout,
never label them exact. Invalidate on policy-context change. Concurrent mailbox
changes make results an as-of estimate unless a stable completed scan is proven;
the review always states that future mail is included. Rate-limit preview jobs
per member and reuse results for an unchanged draft/context.

Publish `@routing`/`@agent` guidance through `DescribeCodeTools`/`ReadCodeDocs`
and `ExecuteCode`: save drafts, show the whole-thread/historical effect, explain
snapshots and overriding exclusions, present confirmation, and report active
only after the server says confirmed. Never infer permission to share from a
request to inspect mail. Review/preview errors cannot fall back to all-mail.
Generate OpenAPI/SDK types and guidance together during implementation; regenerate
conflicting storage SDK outputs instead of hand-merging them.

**Alternatives rejected:** raw settings writes from code mode bypass review;
content previews reveal more than needed; synchronous exact counts over an
unbounded mailbox put expensive work on an interactive request.

### 8. Rollout and compatibility

Use one remote `enable-crm-selective-email-contribution` flag in the web registry
and `crates/feature_flags`. Gate draft/preview/review entry points and backend
activation; a failed flag load refuses new activation. Keep it off in dev until
the privacy dependency and compatibility checks pass, with an explicit registry
comment explaining that exception to the normal dev default. Production rollout
is a separate authorized action.

The flag controls availability of new operations, never the enforcement of a
stored policy. Turning it off freezes new selected activations but keeps existing
selected grants restricted, readable in settings and revocable. It must not
interpret selected as all-mail. Existing all-mail behavior is unchanged.

Recommend an additive compatibility representation in `crm_email_consent`:
`mode` defaults to `all`, and `selected_enabled` defaults false. Keep legacy
`enabled` true **only for active all-mail grants**; selected mode uses
`enabled = false`, `selected_enabled = true`, a valid active revision and exact
mailbox binding. Check constraints forbid both grant bits or a legacy enabled
bit with selected mode. New responses expose the effective enabled state and mode;
old readers/workers that inspect only `enabled` fail closed on selected mail.
Existing rows get the all-mode interpretation, not a consent conversion or a
mailbox backfill. New policy tables start empty.

New migrations must extend mailbox lifecycle revocation to clear both bits,
including when only selected is active. Add a legacy-write guard: an old
`SET enabled = true` on selected mode fails with “review current contribution
settings”; an old withdrawal (`UPDATE OF enabled` to false, even if already
false) also clears `selected_enabled`. New selected activation first disables
legacy consent, then sets the selected grant/revision in the same transaction
without naming the legacy bit in that second update. A confirmed switch to
all-mail clears selected state and explicitly sets mode/all-mail consent.
Lifecycle writes retain mailbox-before-consent ordering and acquire no new team
privacy lock. Test legacy upserts and no-op false updates, not just new handlers.

Deploy schema/guards and compatible read/ingestion implementations before any
selected activation. Older readers may temporarily show no contributed mail;
older workers may acknowledge jobs without population, so do not enable selected
until every worker is compatible. Install the updated SQL function and set-based
parity path before enabling writes. Rollback turns off new activations and leaves
schema, denials and selected policy enforcement in place; it never turns selected
back into all-mail. Roll forward or roll back only to a privacy-compatible build.
Never rewrite an applied migration; use new additive migrations.

**Alternatives rejected:** adding only `mode` beside `enabled = true` lets old
workers ingest all mail; relying on a feature flag alone cannot guard stale
binaries; converting existing consents would change permission without review.

### 9. Independently shippable PR sequence

| PR | Deliverable and release boundary | Dependency |
| --- | --- | --- |
| 0 | This proposal and decisions only; no executable changes. | None. |
| 1 | Land the thread-exclusion API/store, scalar/set-based enforcement and parity coverage. | Separate thread-exclusion PR; required before selective implementation consumes its mechanism. |
| 2 | Add dormant policy/revision/target/audit schema, legacy-write and lifecycle guards, and compatible consent readers. No selected writes and no changes to existing grants. | Approved design and PR 1. |
| 3 | Add selected enforcement to direct/list access and set-based population; indexed candidate narrowing, parity/concurrency coverage and measured query plans. Keep selected activation unavailable. | PR 2; reuse PR 1 predicate. |
| 4 | Add bounded preview, draft validation/storage, revision-aware outbox/backfill and server-owned confirmation protocol, all gated off. Verify every worker is compatible. | PR 3 and a trustworthy member-only review boundary. |
| 5 | Add minimal responsive confirmation/settings UI plus generated SDK methods and agent guidance, integrating the privacy-settings SDK task. Existing all-mail remains usable; flag off. | PR 4 and shared SDK contract. |
| 6 | Enable an explicitly authorized limited rollout after end-to-end privacy, mixed-version and performance verification; update shipped privacy/agent docs. | All previous releases and the separately authorized rollout. |

Reject one combined schema-and-activation release: compatibility, enforcement
and rollback safeguards must be deployed and verified before grants can become
active. PRs 2–5 may be deployed while dormant; none enrolls members. Verify owner
versus admin/agent denial, stale draft/mailbox lifecycle races, whole-thread exceptions,
subdomains, multiple addresses, teammate-copy dedupe, primary-only revocation,
legacy clients and queued old work before enabling. Instrument draft/preview,
activation and backfill spans with revision/count/outcome fields and trace
propagation, without private targets. Browser checks cover confirmation, rejected
activation, withdrawal, stale previews and mobile review. The date-cutoff and
restricted-member projects remain separate and may add further narrowing gates.

## Decisions to confirm and remaining unknowns

Proceed with these recommendations unless the design review changes them:

1. Every agent-authored activation/replacement requires member confirmation;
   agents manage drafts, with no standing authority to expand sharing in v1.
2. Contact/company selections capture confirmed address/domain snapshots;
   later record edits require a new review to change the selection.
3. Privacy removal retains records and prior interaction metadata, and another
   member's independently eligible copy remains visible.
4. Keep the existing personal-email population setting's semantics; treat CRM
   access restrictions and a true date boundary as separate projects.

No additional product question blocks this draft. Implementation must determine
real mailbox/rule distributions and latency budgets, verify the member-only
saved-review capability, and reconcile the final merged thread-exclusion and
privacy-settings SDK contracts. No query benchmarks or live-data verification
were performed for this docs-only proposal.
