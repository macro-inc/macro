# CRM company and contact references scope

Implement the References section and complete associated-item membership for
CRM companies and contacts. This spans reference recording, authorized Soup filtering, both query transports,
and CRM presentation. Adding the existing References component alone will not
satisfy the task.

The code observations below were made at `9af01f1155` on October 7, 2026.

## Required membership

All alternatives below are OR conditions, evaluated before pagination. Other
view filters and source permissions still apply.

| Record | Include an accessible source item when |
| --- | --- |
| Company | Its Companies property contains the company; its Contacts property contains a contact belonging to the company; it references the company; or it references a contact belonging to the company. |
| Contact | Its Contacts property contains the contact, or it references the contact. |

Use the owning CRM record IDs and company membership. A contact query does not
inherit every item associated with its company. Do not equate contacts across
teams using email addresses or use a partially loaded Team tab as the complete
set of company contacts.

Deduplicate associated items by their canonical source entity identity. Matching
both properties, several contacts, or several mentions must not produce repeated
items or consume multiple page slots. References may retain individual message
destinations for navigation, but repeated occurrences in the same source should
not produce duplicate rows.

Preserve the existing email participant scopes and the additional email-attachment
behavior in Files. Those are separate existing inclusion rules, not replacements
for the task's property/reference union.

## Existing implementation and gaps

| Area | Evidence and implication |
| --- | --- |
| Record UI | `features/crm/views/company-detail.tsx` and `contact-detail.tsx` have References TODOs in their floating information panels. Reuse that placement for this task, including embedded and standalone records. |
| Files and Calls | `features/crm/queries/record-items.ts` matches the current record's one system property; Files also includes email attachments. There is no company-contact expansion or incoming-reference predicate. |
| Tasks | `features/crm/record-tasks-adapter.tsx` passes a single `TaskReferenceScope`. `features/tasks-view/queries/use-tasks-query.ts` filters fetched, local-search, continuation, and optimistic rows through property-only membership. A server-only fix would still lose mention-only tasks. `task-query.ts` and `task-search.ts` also encode the single property constraint. |
| References UI | `lib/core/component/References.tsx` reads an unpaginated attachment-reference endpoint. Its generic-reference navigation only opens documents. It cannot represent the complete associated-item contract as-is. |
| Existing reference reads | `crates/channels/src/outbound/pg_channels_repo.rs::get_attachment_references` reads `comms_attachments` and `comms_entity_mentions`. Channel rows check active membership and deleted messages; comment rows (messages on documents, initiatives, CRM records, and calls) are authorized per parent in the domain service through `CommentParentAccess`. The generic-source SQL has no viewer/source ACL predicate; the service forwards those results. Do not expose that raw result as an authorized CRM feed. |
| CRM mention vocabulary | `packages/lexical-core/utils/mentions.ts`, the editor mention plugin, and `crates/messages/src/domain/mentions.rs` already recognize `crm_company` and `crm_contact`. The reference lookup passes unknown type strings through, so a blanket claim that the backend cannot accept CRM targets is inaccurate. |
| Document mention recording | In `MentionsMenu/utils/mentionHandlers.ts`, CRM contacts return after inserting a chip without calling `trackMention`; company selection falls through to tracking the target as `document`. These are concrete gaps in this insertion path. The backend document-creation tracker can separately extract canonical CRM types, so audit creation, editing, paste, and removal instead of assuming every path fails identically. |
| Soup architecture | `crates/item_filters/src/ast.rs` has property filters but no cross-entity incoming-reference/CRM-association selector. Soup fans out to other domain services; its SQL is not the only candidate source. Property-based pruning can skip sources that have references but no matching property rows. |
| Transport and cache | Additions must reach REST `ApiEntityFilterAst`, `graphql_soup_filter_input`, the shared frontend GraphQL AST compiler, grouped queries, cursors, and generated schemas. `useSoupAstItemsQuery` can choose either transport. |

Frontend paths in this table are relative to `apps/web/src`.

## Implementation slices

### 1. Define and authorize the association query

Add a typed association/reference filter to the existing Soup query contract.
The exact type and wire name are implementation choices, but callers must be
able to express the required OR union and compose it with document subtype,
status, grouping, sorting, and other existing constraints.

Keep CRM record visibility, owning-team checks, hidden-record rules, and CRM
enablement policy in CRM/domain services. Use their authorized capability to
expand a company to its eligible contacts. Apply the current policy for hidden
contacts rather than silently widening access for ordinary members.

The hexagonal boundary was checked for this scope: inbound adapters should parse
requests and forward identity/receipts, domain services should authorize and
orchestrate, and outbound adapters should implement set-based reads behind
domain ports. Reference edge reads belong behind an owning-domain contract;
Soup composes the result. Do not import another domain's outbound adapter or
add per-contact HTTP calls. A server-side join or equivalent set-based read must
cover contacts beyond any frontend page limit.

### 2. Filter all relevant Soup candidate sources before limits

Reuse `entity_properties`, `comms_entity_mentions`, and applicable attachment
edges. No new relationship store is indicated. Existing mention indexes cover
target type/ID and source type/ID; assess query plans before adding indexes.

Implement property-or-reference matching inside the authorized candidate query,
before sorting, per-source limits, grouping, counts, and cursor construction.
Preserve the predicate in continuation cursors. Deduplicate with semi-joins or
equivalent set semantics, not by concatenating independently limited lists in
the browser.

Audit every participating source, including document/task, channel message or
thread, call, and other property/reference-bearing Soup types. The task says
any entity: do not silently hard-code a documents-and-calls-only result. Audit
`SoupRequest` sub-request builders and property-less exclusion logic so mention
matches are not pruned, and excluded entity types cannot become unfiltered feeds.

For message sources, retain the actual message, thread, and parent identities.
Channel replies need the correct deep link; discussion messages with another
parent type must not be interpreted as channels. Use the appropriate source
authorization and lifecycle checks. Access to a company or contact never grants
access to the document, message, channel, or other source that mentions it.

Key entry points:

- `crates/item_filters/src/ast.rs` and the affected literal modules.
- `crates/soup/src/domain/models.rs`, `domain/service.rs`, and domain ports.
- `crates/soup/src/outbound/pg_soup_repo/expanded/dynamic.rs`, grouped/unexpanded
  equivalents where the new selector is supported, and delegated source queries.
- CRM directory/access ports and the owning reference read adapter.
- `crates/soup/src/inbound/axum_router.rs` and
  `crates/graphql_soup_filter_input/src/lib.rs`.

### 3. Record CRM references correctly

Correct the verified mention-insertion gaps using the canonical CRM target types.
Preserve reference occurrence IDs so deletion removes the correct edge. Recording
a CRM reference must not invoke file sharing, invite the contact, or notify an
external person. Cover document and task editors and channel/discussion creation,
editing, and removal. Check paste/card and server-created markdown paths that
already extract CRM references; avoid double recording them.

The current insertion behavior means older documents may have missing or wrongly
typed CRM edges. Determine whether historical repair is needed and report the
coverage limitation separately from the new-write fix. Do not infer CRM edges
from every `document`-typed row with a coincidentally matching ID. Any backfill
needs source-content verification and a bounded, resumable design; it is a
separate rollout decision, not an automatic production mutation in this task.

### 4. Wire the CRM sections and shared clients

Add References to the existing floating information panel in both detail views.
Inject the production source/navigation through `crm-adapter.ts` and
`context/crm-context.tsx`; keep views independent of concrete service clients.
Reuse shared reference rows and item navigation where suitable, but use an
authorized, paginated source. Show loading, empty, failure/retry, and load-more
states without treating a failed query as an empty list.

Expose the full property-or-reference association union, and use its relevant
type-restricted subset for the existing Files, Tasks, and Calls sections. Keep
the full associated-item feed able to represent types without their own record
tab. The References section should make those items reachable; do not drop them
because they are not files, tasks, or calls.

Extend the Tasks source contract so server-authorized mention matches survive
row assembly and grouped continuation. Scope local search and optimistic inserts
without admitting unrelated cached tasks. Preserve task creation's current
Companies/Contacts defaults. Task search must retain the same association scope;
do not silently fall back to property-only results. If the current OpenSearch
path cannot express it, use an explicit server-backed scoped path or implement
the missing scope support, with complete pagination rather than searching only
one loaded page.

Extend `lib/queries/soup/graphql/ast.ts` and transport tests. Regenerate REST
models as needed, export the GraphQL SDL with the documented command, then run
`bun gen-graphql` in `apps/web`. Preserve normalized entity identities; query
membership is not a new global entity fact. Verify refresh after property and
mention changes, contact/company switching, and permission changes.

### 5. Verify the contract and update the app guide

| Regression case | Required result |
| --- | --- |
| Four company rules independently | Each produces a match; contact-only links work without a Companies property. |
| Two contact rules independently | Both match; company-only and sibling-contact-only items do not. |
| Several paths or repeated references | One associated item per source identity; stable page boundaries. |
| Large company and small page size | Contacts beyond the first UI page and items beyond the first result page remain discoverable. |
| Unauthorized source or target | No source content, identifiers, previews, or counts leak; disabled/hidden CRM and other-team cases honor policy. |
| Deleted/removed data | Deleted source messages/documents and removed mentions stop matching; revoked access is respected. |
| Message references | Root/reply destinations navigate correctly; non-channel discussion parents are handled explicitly. |
| Both transports and grouped Tasks | Membership, sort, grouping/counts, and continuation agree; mention-only rows survive frontend filters. |
| Editing and refresh | Creating/removing CRM mentions and changing properties refresh the relevant lists without a reload. |
| Existing record behavior | Emails, email attachments in Files, task creation defaults, call links, and embedded/standalone navigation continue to work. |

Run meaningful domain allow/deny tests, SQLx integration tests for the joins and
cursor behavior, and focused CRM/Tasks/mention/GraphQL compiler tests. Run Rust
package tests from the root with `SQLX_OFFLINE` unset; read package names from
their manifests. Generate SQLx metadata through the documented workspace
workflow rather than editing cache files. Run TypeScript checking, affected
package tests, and `just check`.

Exercise the resulting UI against the changed backend in an isolated local
stack, including company/contact References, Files, Tasks, Calls, and message
navigation. A frontend talking only to the deployed dev backend cannot verify
new query behavior. Update the CRM section in `docs/agent-guide/crm.md` and
any changed mention/navigation guide. Report blocked checks precisely.

## Delivery boundary

This is one feature with five reviewable slices, with the largest work in the
authorized query and reference-recording paths. It does not require a CRM
pipeline/database redesign or a new service. The proposed UI placement uses the
existing References placeholders and preserves the current top-level tabs.

## Implementation decisions

Recorded after implementation.

**Contract.** `EntityFilterAst` gained `crma` (`CrmAssociation`: `{ company }` or
`{ contact }`), an AND scope over every Soup source, and the document literal
`crm` with the same value, which composes inside a document tree. Files uses the
literal so it can OR the association with the email-attachment participant rule;
Calls, Tasks, and References use the scope. Both reach REST (`ApiEntityFilterAst`),
GraphQL (`crmAssociation`, `crmAssociated`), and the frontend GraphQL compiler. A
document `nc` (name contains) literal was added for scoped task search.

**Resolution.** `SoupImpl` resolves every named record before any source query:
`CrmService::resolve_association` authorizes the record with the viewer-scoped
contact-listing policy (membership of a CRM-enabled team; hidden companies and
contacts only for admins and owners; team-scoped bots restricted to their team)
and returns the company with all of its visible contacts, or the single contact.
An invisible record is `404` (`SoupErr::CrmRecordNotFound`), never an empty
page. Edges are then read as complete sets: `SoupRepo::crm_property_edges`
(Companies/Contacts values, backed by two new partial GIN indexes like the
assignee/status/project ones) and `ChannelListService::get_reference_sources` in
the channels domain, which owns `comms_entity_mentions`; it returns documents
and undeleted messages that mention or attach a target, with message thread and
parent identity. Soup groups the edges per source and ANDs an id set into each
source tree (the favorites precedent), so each source's own access checks,
filters, sort, limit, grouping, counts, and cursor apply after the association.
Cursors keep the unresolved record, so every page re-authorizes. Frecency,
touched, and notified sorts, unexpanded (`expand=false`) requests, and the work
feed reject associations with a 400. Grouped queries resolve without a team
receipt (viewer scope).

**Source mapping.** Property rows map by entity type (document/task, chat,
project, initiative, database row, calendar event, email thread, call, channel,
CRM company, CRM contact); users are not a Soup source. A document mention maps
to the document. A channel message maps to its top-level thread row (a reply to
its root), so it navigates to the thread. A discussion message maps to its
parent document, initiative, call, CRM company, or CRM contact; a record's own
discussion or property is not its association. Foreign entities and agent
sessions carry no association.

**Reference recording.** Document and task editors now record CRM company and
contact chips as `crm_company` / `crm_contact` mentions with a mention id, so
removal deletes the edge; companies no longer call the document share/attach
callback. Message editors already record CRM mentions on send and edit. Routed
documents (`/app/drive/md/...`) previously recorded no mentions of any type: the
mentions menu read its source from the legacy block context, which those routes
lack. The menu now takes the source from the editing surface. Recording
publishes the existing `mention.created` event only; nothing is shared, invited,
or notified. Mentions, CRM property saves, message edits and deletes, and sends
that mention or attach a CRM record refresh the mounted CRM-associated lists on
both transports.

**Frontend.** Files, Calls, and Tasks use the association. Tasks pass a `crm`
scope to the Tasks source: server rows and grouped continuations are not
re-filtered by property; optimistic inserts are admitted only when the task's
own property names the record; search runs the scoped Soup query with the `nc`
literal (names only, complete cursor pagination) instead of the search service.
Both detail views add a References section to the floating information panel,
listing the full union (all sources plus CRM contacts) with loading, empty,
error/retry, and load-more states, through `createRecordReferences` in the CRM
context. Its rows use the shared list's condensed narrow layout (icon and name)
so task properties do not crowd the panel; the full-width tabs are unchanged.

**Sources References cannot list.** Initiatives and database rows are opt-in
Soup sources, like agent sessions and CRM contacts: the association constrains
them only when a request asks for them. `ApiEntityFilterAst` has no initiative
or database-row field, and the References body asks for neither on GraphQL, so
an initiative or database row that names or references the record is not
listed. This affects only References; Files, Tasks, and Calls never include
those types.

**List failures.** The Soup facade exposes `isFetchNextPageError` from both
transports. A failed continuation page keeps the loaded rows and retries that
page; any other failure, including a refetch after the record became
inaccessible (`404`), replaces the rows with the list error, and Retry
refetches the query. A GraphQL transport failure with current cached results
still keeps them, as before.

**Email without a mailbox.** A CRM-scoped email query reads teammates'
mailboxes, but `SoupRequest::build_email_request` skipped email for any caller
without a linked mailbox, so such a teammate's company and contact Emails `Team`
tabs were always empty. It now skips only requests without a CRM scope;
CRM-scoped requests still go through email's CRM scope authorization.

**Historical data.** Existing documents can lack CRM edges: contact chips were
never tracked, and company chips were stored as `document` mentions. Soup only
matches `crm_company` and `crm_contact` edges, so mistyped rows are ignored
rather than guessed. Repairing them needs a separate, resumable backfill that
re-extracts mentions from document content (the lexical extractor already
emits canonical CRM types) and replaces only verified rows; it is not part of
this change.
