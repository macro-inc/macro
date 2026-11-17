# CRM company merge

Status: proposal, not shipped. Investigated against `origin/main` at
`3c928f07cde6f76a3262f34449d22ec7b6850095` on October 26, 2026. This covers
non-search work only and does not depend on an external implementation.
The first delivery is this specification, consumer inventory and alias contract;
it does not enable merging or complete the feature's acceptance criteria.

## Confirmed case

The October 24 CRM bugs screenshot shows two companies with the display name
“Vantora | Conquer Your Toughest Enterprise Problems”: one with `uplabs.us`,
the other with `vantora.us`. This is a multiple-domain company case. The
screenshot does not establish which record should survive, their access settings,
or whether either has conflicting fields. There was no reply in the source
thread when inspected.

## Proposed pilot contract

These policy choices need agreement before exposing a merge mutation:

- A team admin or owner selects at least two visible companies from the same
  CRM-enabled team, then explicitly chooses a survivor. This matches the
  governance role used for hiding companies and changing email sharing.
- Desktop selection uses the existing Companies list selection/actions. On
  mobile, the same action opens a scrollable sheet with the survivor and conflict
  choices; it must not require a keyboard modifier or hover.
- Preview the domains, names, field conflicts and privacy outcome. The API and
  agent tool expose the same preview and require its revision when committing.
  A changed record invalidates the preview rather than applying stale choices.
- Retain all domains and contact IDs. Do not infer that matching company names
  mean matching companies, or that matching contact emails prove one person.
- No automatic suggestions or unmerge in the pilot. Confirmation says the merge
  cannot be undone; retention for audit is not an undo promise.
- Do not change global `crm_domain_directory` rows. Keep the survivor's primary
  domain and directory identity; preserve other domains as aliases.

## Preservation and conflicts

| Data | Proposed rule |
| --- | --- |
| Company IDs | Store a durable, team-scoped alias for every retired ID. Resolve aliases before authorization and reads, and canonicalize or explicitly reject stale writes. Flatten aliases when the survivor is merged again; never leave cycles. |
| Domains | Move the union without changing normalized domain identity or global enrichment. The current primary-domain rule is earliest `created_at`; adding an older source domain must not silently replace the survivor's primary domain. Define an explicit primary choice with the multiple-domains work. |
| Contacts and links | Retain IDs, names, sources, hidden state, timestamps, and independent relationships. Move company links. A `(company_id, email)` collision must be resolved through the shared contact-identity contract, not `ON CONFLICT DO NOTHING` or deleting one contact. |
| Team custom names | Keep the selected survivor's name by default. Show different source names in preview and preserve them in authorized merge history; allow an explicit replacement. |
| Company properties | Compare values by property-definition ID, not display name. Fill empty values, deduplicate equal values, and union only fields whose type/cardinality allows it. Require an explicit choice for conflicting scalars or single-select values. Preserve alternative values and provenance with their original visibility. |
| Pipeline entries | Retarget each existing entry without changing its row ID, fields, journal, order, or grants. Distinct deals in the same pipeline stay distinct; two entries are not duplicates merely because their company is now the same. |
| References, files, calls and database cells | Preserve their source IDs and ACLs. Resolve old company references and deduplicate associated-item membership by source identity. Do not copy files or grant access to the source item. |
| Discussions | Preserve message IDs, authors, thread structure, attachments, edits, deletion state and read state. Include all discussions on the survivor without copying messages. A hard delete currently cascades these messages, so deletion cannot precede preservation. |
| History and activity | Preserve old navigable links and existing activity. Record one merge event with the actor, survivor and source identities. Private field values must not be copied into a team-visible activity payload. |

Company property conflicts and contact identity collisions are different
operations. The pilot must not silently perform a contact merge as a side effect
of a company merge. If the contact model cannot represent a collision without
loss, the entire company merge returns a specific conflict with no writes.

## Access and concurrency

Authorization belongs in the CRM domain service, shared by UI/API and agent
tools. A team receipt is not enough by itself: recheck every selected company's
team, lifecycle and hidden state in the committing transaction. Cross-team or
unavailable records must not leak their names or whether they exist. A distinct
hidden-record error is appropriate only for a caller allowed to know that state.

Merging never grants access to a referenced document, pipeline, call, discussion
source, email or personal record. Reject hidden source companies in the pilot;
keep individual contacts' hidden flags. Existing email authorization uses both
contact and parent-company flags. With only one company-level `email_sync` flag,
use the intersection (false if any selected company is false), show that outcome
before confirmation, and preserve mailbox consent and team opt-outs. Supporting
different sharing settings per merged domain instead needs a new permission
model and a separate decision.

The merge must commit atomically across the affected owning domains. Do not
chain existing HTTP operations or issue raw SQL against other domains' tables
from CRM. Add transaction-capable ports in their owners, following the existing
`DatabaseStorageProvisioner::create_storage_in` pattern. Pipeline cell changes
must preserve database locks, versions, journal and change notifications.

Acquire locks in a documented shared order with populate, depopulate, manual
creation, hide and property/pipeline writers. Existing CRM domain locks are keyed
by `(team_id, lower(domain))`; company-row locks alone do not serialize those
writers. Re-read the alias/domain set after locking and reject a stale preview.
Prevent a queued sync, cleanup, stale UI edit or replayed import from recreating
a retired company or orphaning its data.

Use a request ID scoped to the actor/team and a request fingerprint. An exact
retry returns the committed result and emits no extra activity; reuse with a
different payload returns a conflict. An independently merged source resolves
to its current survivor in the authorized error response and requires a new
preview. Do not treat every already-merged record as the caller's successful
operation.

## Alias and API contract

Use the CRM company UUID as identity, including companies without domains.
Coordinate with the optional-domain creation change (`Option<&str>` at the CRM
service boundary); a missing domain must not prevent lookup, preview, or merge,
and names are never unique keys. Independent contacts and many-company links are
follow-on identity work, so the first merge implementation must explicitly reject
contact collisions it cannot preserve.

Proposed persisted contracts, with final SQL names to be selected during
implementation:

| Record | Identity and invariant |
| --- | --- |
| Company alias | A globally unique retired company UUID, owning team UUID, current canonical company UUID, and merge-operation UUID. Enforce same-team target ownership in storage, one target per retired ID, no self-targets/cycles, and no reuse of a retired ID. On a subsequent merge, atomically retarget every incoming alias to the final survivor. |
| Merge operation | A UUID with actor/team identity, request key, request fingerprint, survivor, source IDs, committed timestamp and result. A uniqueness constraint covers `(team, actor, request_key)`. The exact result is retained for retries. |
| Merge choices/history | Versioned values, origin record IDs and explicit choices. Store private values only through a representation that retains their original access scope; the team activity event contains identities, not these values. |

An internal batched resolver accepts a verified team/viewer scope and requested
company IDs, and returns authorized requested-to-canonical mappings. Authorization
must check the owning team and the canonical record's current hidden/lifecycle
state on every call. The resolver is not an unauthenticated existence probe.
Retirement must not appear as an ordinary hidden company in admin lists.
Permanent deletion of the canonical company makes its old IDs unavailable;
neither a stale request nor a later create may resurrect them. Tombstone retention
must outlive all possible stale writers and retries, with team deletion handled
by the owning lifecycle policy.

All company reads within this non-search scope share that resolver: direct
REST/GraphQL fetches, tools, mentions/previews, entity-property hydration,
pipeline record hydration, discussion navigation and association expansion.
Return the canonical ID in the entity payload, and explicitly map the requested
key to it in batched/cache results. Otherwise a batched loader keyed by an old ID
will treat the successful canonical lookup as missing. The UI replaces the old
URL while retaining any discussion/message destination.

For writes, the receipt must identify the canonical company actually mutated.
Never authorize the survivor and then write an unvalidated original ID. A stale
mutation carrying a retired ID returns `company_already_merged` with the canonical
ID only if the caller can access it; the client reloads and requests a new
preview. Identity-retargeting of private references is an internal preservation
operation, not permission to expose their source data to the actor.

Proposed transport shape (names are illustrative, not generated wire types):

```text
preview({ survivorId, sourceIds[] })
  -> { previewId, revision, expiresAt, domains[], fieldConflicts[],
       emailSharingResult, canCommit }

commit({ previewId, revision, requestId, fieldChoices[] })
  -> { operationId, survivorId, retiredIds[], committedAt }
```

Bind the persisted preview to its actor/team, exact source/survivor set, and all
relevant company/property/pipeline/permission revisions. The client cannot supply
authoritative preview facts. A commit transaction validates those revisions,
rechecks current authorization, and writes only after every conflict is resolved.
Do not expose names, counts, values or conflict identifiers from inaccessible
sources in preview. If an inaccessible conflict cannot be retained safely without
an actor's decision, refuse the operation with a non-disclosing conflict.

| Error | Behavior |
| --- | --- |
| `merge_permission_required` | 403 for an authenticated caller lacking the required merge role. |
| `company_unavailable` | 404 for absent, foreign-team, deleted or otherwise inaccessible input; no distinguishing metadata. |
| `company_hidden` | 409 only when the authorized caller may know the record is hidden; no writes. |
| `company_already_merged` | 409 for a newly submitted operation containing a retired input; include the canonical ID only when accessible. |
| `merge_preview_stale` / `merge_preview_expired` | 409; discard preview and build a fresh one. |
| `merge_conflict` | 409 for unresolved fields or unsupported contact collisions; only authorized details. |
| `merge_request_reused` | 409 when the same request key has a different fingerprint. |

An exact retry checks the committed-operation record before the retired-input
check, then reauthorizes access before returning its saved result. This is the
exception to `company_already_merged`; it never repeats writes or activity.

## Current implementation seams

Paths are relative to the repository root. This is a starting inventory, not a
claim that all consumers have been migrated.

| Owner / path | Required integration |
| --- | --- |
| `crates/crm/src/domain/service.rs`, `domain/auth.rs`, `inbound/axum_router.rs`, `inbound/toolset.rs` | One authorized preview/commit use case; both transports share typed errors and policy. Existing writes have no company-merge operation. |
| `crates/crm/src/outbound/companies_repo.rs` | Company/domain/contact persistence, sorted advisory locks, name/hidden/email-sync writes, populate and both cleanup paths. |
| `crates/macro_db_client/migrations/20260512120000_crm_tables.up.sql` | Contacts require a company and are unique on `(company_id, email)`; domains already support many per company. The later `20260514130000_crm_domains_team_id.up.sql` makes normalized domains unique per team. |
| `crates/entity_access/src/outbound/pg_access_repo/queries/crm_company_access.rs` | Direct-user and team-scoped alias access; canonical identity must not bypass team/hidden checks. |
| `crates/entity_access/src/outbound/pg_access_repo/queries/thread_access.rs` | Email access derives opt-outs through `crm_contacts.company_id`; test mixed sharing settings. |
| `crates/crm/src/outbound/companies_repo/association.rs`, `crates/crm/src/outbound/lookup.rs` | Canonical/alias hydration and complete, viewer-authorized association expansion. |
| `crates/crm/src/outbound/pipelines.rs`, `crates/databases/src/domain/ports.rs` | Pipeline references are database-row entity properties. Retarget through the database owner while preserving versions and journal. The current write port owns its transaction. |
| `crates/properties/src/domain/ports.rs`, `crates/properties/src/outbound/entity_property_queries.rs` | Company fields, incoming Companies values, owner-scoped definitions and concurrent property edits. |
| `crates/macro_db_client/migrations/20260928152757_crm_discussion_parents.sql`, `crates/messages`, `crates/channels` | Discussion parent FKs cascade on company deletion; mention/attachment edges and discussion readers need preservation and alias handling. |
| `crates/activity/src/domain/models.rs`, `crates/activity/src/domain/events.rs` | Durable merge action, visibility-safe payload and reliable publication. Existing actions do not include company merge. |
| `apps/web/src/features/crm/crm-action-items.ts`, `views/company-detail.tsx`, `queries/`, `packages/sdk` | Multi-selection, preview/conflict confirmation, old-link navigation, cache invalidation and generated API contract. |

The linked-database-row worker's October 26 contract is still in implementation,
not part of the main commit inspected above. It adds CRM-owned
`crm_database_row_links` through `RowLinksRepo` / `CrmRowLinks`. Company links will
need retargeting and deduplication by `source_row_id`, retaining source database,
table and row IDs and their ACLs. Deal links belong to `(pipeline_id,
entry_row_id)` and stay on that entry when its company changes. The proposed
per-target 100-link limit cannot discard links during a merge: choose an explicit
capacity policy or refuse the entire operation. Its company FK is planned with
delete cascade, so include these links in the preservation transaction before
retiring a company.

## Delivery gates

1. Agree the pilot policy and coordinate the contact/company identity contract
   with the flexible-company-links work. A final schema and collision rule must
   be shared, not invented independently by both implementations.
2. Add compatible alias/merge-operation storage and owner-provided transactional
   capabilities. Deploy readers and write guards before enabling any merge;
   older services must not recreate retired identities during a rolling deploy.
3. Add the CRM preview/commit service, HTTP/SDK/agent surfaces, and desktop/mobile
   confirmation using the same conflict rules. Ship behind an explicit rollout
   gate until all participating readers and writers are compatible.
4. Verify the Vantora two-domain case; source-to-survivor and survivor-to-new-
   survivor links; conflicting scalar/multi-value/name fields; contact collision;
   private pipeline/file/call access; hidden contacts; mixed email sharing;
   stale preview; exact retry; opposing simultaneous merges; concurrent sync,
   property writes and cleanup; rollback after a mid-transaction failure;
   reload; and exactly one visible activity event.

Search implementation and Search-vault changes are outside this work. Before
enabling merges, the coordinator must explicitly decide how compatibility of
excluded discovery consumers is handled; this proposal does not certify those
consumers or waive their existing access guarantees.
