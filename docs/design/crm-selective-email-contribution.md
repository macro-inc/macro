# Selective CRM email contribution

Status: implementation in phases. The product direction is direct agent
activation, whole-thread matching, live contact/company selectors and retained
CRM records after narrowing. Source observations are from `76c2186fa4d`.
The first phase supplies dormant storage and compatibility guards; selected
contribution must remain unavailable until every eligibility path is upgraded.

## Problem and scope

A member can currently contribute all eligible mail or none. Domain exclusions
cannot express “only these conversations, people, or companies.” Add a selected
consent mode whose inclusion rules the member or an agent acting as that member
can manage through the SDK. Existing all-mail consents remain unchanged. There
is no visual rule builder in v1 and no required member confirmation for each
agent activation. The member can inspect, edit or withdraw their rules anytime.

Contribution controls what a mailbox shares, not who can use CRM. Restricting
some team members from CRM or databases remains a separate authorization project.
Selected consent does not provide a restricted member role.

## Current behavior and constraints

- `crm_email_consent` is keyed by team/member and binds consent to the exact
  primary `email_links.id`. Mailbox lifecycle changes revoke it, including changes
  that retain the link ID. Leaving a team deletes consent. Opt-in covers past
  and future eligible mail and atomically enqueues `crm_email_backfill_outbox`.
- Team and personal domain blocks include dot-boundary subdomains. A blocked
  sender or recipient, including CC/BCC, in any non-draft message denies the
  whole contributed thread. Legacy company `email_sync = false` also denies.
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
| Address | Trim and lowercase a validated address; match exactly without stripping plus tags/dots or inferring aliases. |
| Contact | Match every current `crm_contact_emails.email` for the referenced contact in this team, including secondary addresses. Resolve live on reads and ingestion. |
| Domain | Normalize and validate a bare domain; match it and dot-boundary subdomains. Reject wildcards, public suffixes and personal-provider domains using maintained domain/provider classification. An individual address at a personal provider remains selectable. |
| Company | Match its current `crm_domains` in this team. Resolve live; do not expand through unrelated personal addresses of its contacts. |

Contact and company selectors **follow the record as it changes**. Adding or
removing an address/domain changes matching without a rule activation. A source
with no current targets matches nothing and carries a warning; it may match later.
Deletion, loss of applicable visibility or a move outside the team makes the
reference inactive. A rename does not retarget it. A merge that deletes the old
ID does not silently transfer consent to another ID. The agent can replace the
reference explicitly. Preserve existing record/parent authorization checks.

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

Use compare-and-swap on database-owned `policy_version` and an idempotency key
for mutations; stale changes return 409. A definition revision, policy version
and `schema_version` are distinct. Concurrent source edits do not rewrite the
rule revision: preview results carry a separate effective-context generation.
Unknown future modes/versions fail closed, never become all-mail.

**Alternatives rejected:** a team allowlist enrolls other people; snapshots fail
to follow the selected record; unversioned JSON loses safe replacement and audit;
a generic expression engine is harder to authorize, index and explain.

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

The member's privacy settings show mode, exact mailbox, active definition,
current live targets, warnings, applicable denials, last change and its actor.
Provide a plain JSON editing surface with validation and a readable selector
list, plus immediate withdrawal. Link to owner-only, keyset-paginated history:
who changed what, when, the before/after definition and the resulting state.
Display live-source changes separately from agent rule replacements so a contact
edit is not falsely attributed to the last activating agent. Use existing
responsive settings patterns on mobile; no separate visual rule builder.

Record activation atomically with the revision, targets, consent and outbox.
Audit actor category (member, verified delegated agent, API credential, system),
verified agent/session provenance when available, timestamp, prior/new revision,
policy version, consent wording version and outcome. Never trust an actor ID
supplied in a request body. Credentials with no verifiable agent attribution
are labeled API, not guessed to be human. Address-bearing definitions/history
are private settings; admins receive no other member's targets or previews.
Operational logs carry counts, revisions, timings and outcomes, not target JSON
or mail content. Return the active revision and effects to the agent immediately.

Mutations use the exclusive team privacy lock, then mailbox/membership locks
before consent/revision writes, following existing order. Recheck primary mailbox,
connection, membership, target authorization and CAS inside the transaction.
Withdrawal remains immediate and independent of a publisher's network lock.
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
the desired policy generation through paged historical work but authorize
against current state before enrichment and again in the write transaction.
A stale generation alone must not discard unfinished eligible history. After
narrowing, finish the remaining scope with current eligibility or durably transfer
it to the replacement job before acknowledging/canceling the old one. Only now-
denied work may no-op without replacement. Completion must compare the claimed
generation so it cannot erase a newer request.

A source-record edit may affect many policies. Persist reconciliation work with
that edit, use indexed reverse references and bounded fan-out, and coalesce
backfills per member. Do not make one contact edit synchronously scan every
mailbox. Authorization always resolves live data; asynchronous reconciliation
only refreshes counts/history/population, never grants stale access.

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
Add separately reviewed participant lookup indexes if measurement requires them.

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

| Proposed method | Contract |
| --- | --- |
| `get()` | Caller-only effective consent/mode, exact mailbox, policy version, active rules, current live targets and applicable exclusions. |
| `validateRules(input)` | Authorize and canonicalize; return current live resolution, warnings and field errors. No grant and no mailbox content. |
| `replaceRules(input, {ifPolicyVersion, idempotencyKey})` | Directly activate the validated replacement for the authenticated member; return revision, audit event and whole-thread/live effects. No human approval token. |
| `previewRules(input)` | Start a bounded asynchronous comparison for the caller's mailbox; return a preview handle. Validation is repeated at activation. |
| `preview.get()` | Status, as-of time/context and distinct counts: current, proposed, added, removed, retained and denied; no IDs, subjects, participants or bodies. |
| `history({cursor})` | Owner-only keyset history of actor, definitions, live-source events and resulting state. |
| Existing consent/domain/thread methods | Reuse the privacy-settings/exclusion APIs; modern mode transitions use the same CAS/audit domain path. |

Counts concern the caller's copies, not conversations disappearing for the entire
team. Denial reason counts may overlap. Never inspect another mailbox to dedupe
a preview. Use keyset batches, progress/cancellation and a proposed five-minute
job budget. Timeout returns explicit partial/lower-bound counts, never an exact
claim. Invalidate on relevant privacy/live-source context changes. Concurrent
mail updates make counts an as-of estimate unless a stable scan is proven.
Rate-limit per member and reuse unchanged definition/context results.

Publish routing/agent guidance through `DescribeCodeTools`/`ReadCodeDocs` and
`ExecuteCode`: agents may manage and activate rules directly, must explain past
and future whole-thread sharing and live references, must preserve overriding
exclusions, and report active only after the server commits. A request merely
to inspect mail is not a contribution instruction. Errors must not fall back to
all-mail. Regenerate OpenAPI and SDK outputs; never hand-merge generated files.

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

Mailbox lifecycle revocation clears both bits, retaining mailbox-before-consent
lock order without a new team advisory lock. An indexed exact-link update must
also find selected-only rows. Reconnection does not reactivate either mode.
Test real legacy upserts, no-op withdrawal and membership/mailbox cascades.

Deploy schema/guards and all three compatible eligibility paths before any
selected activation. Older readers may temporarily show no selected mail; old
workers may acknowledge without population, so **every worker must be upgraded**
before enablement. Once active, an old-binary rollback is fail-closed only and
requires a later backfill repair; never roll back schema/guards or widen consent
to preserve old-binary visibility. Keep stored restrictions enforced indefinitely.

**Alternatives rejected:** reusing `enabled=true` for selected leaks through old
readers; deployment ordering without guards cannot protect rolling clients;
flag-off-as-all-mail turns a rollout control into a disclosure.

### 9. Independently shippable PR sequence

1. **Dormant foundation and revised design.** Typed rule format, empty revision/
   target/audit tables, additive consent fields, legacy-write/version/lifecycle
   guards and the default-off key. Test existing consents and old writers. No
   activation API or eligibility edits. This can ship before thread exclusions.
2. **Eligibility and live resolution.** After PR 1 **and merged thread exclusions**,
   update `crm_email_thread_allowed`, set-based ingestion and the inlined Team
   reader together, plus compatible consent readers. Reuse its veto, add indexed
   live-target joins/reverse references and parity/performance evidence. Still
   expose no selected activation. Base new migrations after the latest merged
   dependency; never change an applied migration.
3. **Policy API and historical work.** Own-member/agent authorization, bounded
   validation/count preview, direct CAS activation, audit, live-source durable
   reconciliation and revision-safe backfill. Default-off backend flag; legacy
   and modern transitions share effective consent semantics. Depends on PR 2
   and confirmed ingestion compatibility.
4. **SDK and member settings.** Read/validate/replace/preview/history methods,
   code-mode guidance, readable rules/JSON edit/history/withdrawal UI, default-off
   registry entry and responsive presentation. Coordinate with the existing
   privacy SDK task. Depends on PR 3; regenerate storage SDK conflicts.
5. **Rollout hardening and readiness.** Integration/parity/performance tests,
   mixed-version drills, concurrent source edits/backfill recovery, flag-off and
   rollback checks, operational counters and rollout runbook. Depends on all
   prior PRs. Enabling flags or deployment requires separate authorization.

## Remaining implementation questions

No further product decision is required to begin the foundation. Verify actual
mailbox/rule/live-target distributions before setting rollout budgets; the sizes
above are assumptions. Confirm credential provenance available for agent audit,
the privacy SDK task's final names, and the merged exclusion contracts against
code. None requires a member-only approval capability. The separate cutoff and
CRM-access projects retain ownership of their product boundaries.
