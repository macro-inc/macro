# crm

## What it is

Part of CRM (Sales): a hexagonal crate for companies, contacts, and
pipelines (including the legacy-CRM → Sales migration), plus the AI
tools/HTTP/GraphQL surfaces over them.

## Start here

- `src/domain/service.rs`, `src/domain/pipelines.rs`: core use cases.
- `src/domain/pipeline_commercial.rs`: protected Outcome and amount/currency
  identities, insert defaults and write validation, for pipelines that track a
  record; `apply_ops` runs it before stage-requirement validation. A generic
  pipeline, or one from a writer older than the migration, has no such fields.
  See the [outcome/currency design](../../docs/design/crm-outcome-currency.md)
  for migration assumptions.
- `src/domain/pipelines/requirements.rs`: stage-entry rules keyed by column and
  option IDs. `apply_ops` validates every pipeline write under the pipeline write
  guard; agent/CSV workflows use the same service. Deletions cascade rules.
- `src/domain/pipeline_workflows/`: pipeline entry/field/record ops built on
  the shared `databases` engine (Sales pipelines are a `databases` consumer).
- `src/domain/crm_csv.rs`, `src/domain/crm_transfer.rs`: CSV import/export for
  agents and the SDK (companies, pipeline entries, pipeline exports as text or
  a saved file). Writes go through the
  pipeline workflows and `CrmService`; CSV files reach documents through the
  `CsvFiles` port, implemented in `ai_tools::crm_csv_files`.
- `src/domain/record_import.rs`: `CrmRecordImports`, the companies, contacts
  and deal pipelines another CRM's import (HubSpot) writes, with the viewer's
  receipts: companies by domain (personal providers never key one), contacts
  with every free address, and company pipelines whose entries carry `Deal`,
  `Close date` and `Source link` beside the standard Stage, Outcome, Owner
  and Revenue. Every stage is checked against the select-option rules before
  the pipeline is created, since its stages are set only after it exists. An
  existing deal entry is found from its company's entries
  (`record_entries`, indexed by record), never by scanning the pipeline.
- `src/inbound/axum_router.rs` (+ `axum_router/*.rs`): HTTP handlers.
- `src/inbound/pipeline_workflows.rs`: HTTP routes over the pipeline workflows
  and CSV transfers (entries by record, fields by name, options by label),
  merged into `/crm` beside `src/inbound/pipelines.rs`; the SDK's pipeline
  entry methods call them, and `GET /crm/pipelines/details` (every pipeline
  with its fields and version, as `ListPipelines` sees them) backs
  `crm.pipelines.listWithFields()`.
- `src/inbound/toolset.rs` (+ `toolset/*.rs`): AI tool definitions.
- `src/outbound/companies_repo.rs`: the Postgres adapter for companies/contacts.
- `SALES_BACKFILL.md`: how the legacy-CRM-to-Sales migration behaves.

## Scope

- Owns: CRM company/contact records, pipelines, and their HTTP/AI-tool/search
  surfaces for a team.
- Not here: the contact *graph* (who a user knows) → `crates/contacts`;
  shared database storage/positions → `crates/databases`.

## Boundaries

- Cargo features gate what's pulled in: `lookup` and `search` are read-only,
  sqlx-only slices for other domains to depend on without pulling in
  `unfurl`/`axum`; pick the narrowest feature for a new caller.
- Depends on: `entity_access` (ports-and-adapters base), `databases` (ports),
  `filter_ast`, `item_filters`, `macro_authorization`, `properties`.
- Used by: `email`, `memory`, `ai_tools`, `soup`/`models_soup`, `graphql_crm`,
  `search_service`, `complete_graph`; composition roots include
  `document_storage_service`, `agent_harness_service`, `mcp_service`,
  `email_service`, `agent_trigger_service`, `scheduled_action`.

## Recipes

- Add an HTTP route: `src/domain/service.rs` (or a domain submodule) →
  `src/inbound/axum_router/<name>.rs` → `src/inbound/axum_router.rs` (mount it).
- Add an AI tool: `src/inbound/toolset/<name>.rs` → `src/inbound/toolset.rs`
  (register it) → its `test.rs`.
- Change pipeline behavior: `src/domain/pipelines.rs` or
  `src/domain/pipeline_workflows/*.rs` → `src/outbound/pipelines.rs` →
  matching test under `src/domain/pipeline_workflows/*/test.rs`.

## Checks

- `cargo test -p crm` (`SQLX_OFFLINE` unset; needs a local MacroDB — see
  `.agents/rules/rust/guardrails.md`). After query/migration changes, run
  `just sqlx::prepare_db "$DATABASE_URL"` from the repository root inside Nix,
  using the same isolated database as the tests.
- For member-access changes, also run `cargo test -p crm --all-features member_access`;
  the HTTP, search and tool revocation test requires the `search` feature.
- After tool input or description changes, regenerate frontend tool types using
  the [entity creation guide](../../docs/guides/add-entity.md#13-ai-and-mcp-tools);
  CI checks the output.

## Gotchas

- Selected-email policy types live in `domain/email_rules.rs`; their validation
  checks format/resource bounds only. Target authorization and activation are
  separate operations. Selected storage keeps legacy `enabled` false;
  recognize `enabled OR selected_enabled` for compatible grant readers without
  bypassing legacy-write guards. Keep the scalar predicate, set-based ingestion
  and inlined Team reader in parity; live contact/company selectors follow
  same-team role visibility and retain every exclusion veto. Activation is gated by default-off
  `enable-crm-selective-email-contribution`; inspection and withdrawal remain
  available independently. Keep the flag off until all PR 5 gates pass.
  Private rule controls use the membership boundary of `/crm/email-privacy`,
  including after CRM viewing denial; resolving CRM details still needs record access.

- `domain/email_rule_discovery` owns bounded live-source discovery and work
  accounting; `outbound/email_rule_discovery.rs` supplies factual PostgreSQL
  reads on the caller's transaction. Reuse the same core for policy validation,
  replacement admission and Team reads. Resolve each shared source once,
  retain member visibility, and return a complete result or a named limit error.
  Keep small/folded strategies within the same ceilings; a direct-pair threshold
  switches strategy rather than rejecting an otherwise bounded policy.
  Composition roots inject this adapter through `EmailRuleDiscoveryService`;
  the lightweight `email_discovery` feature exposes it without the full CRM
  service. Admission must precede grants and preserve withdrawal after overflow.
  Batch first pages for more than eight distinct live sources; charge every
  prefetched raw row before continuing a full source. Keep the total batch within
  the remaining allowance plus one sentinel, including duplicate and foreign-team
  values.

- Private policy storage lives in `domain/email_policy.rs` and
  `outbound/companies_repo/email_policy/`. Inspection must never initialize consent or move historical work. The first
  policy mutation compares the legacy observation under locks, initializes
  identity and transfers history atomically. `Existing` never creates a row.
  `email_policy_api.rs` owns opaque CAS, direct activation and trusted actor audit.
  Use empty struct variants for payload-free policy commands so serde rejects unknown fields.
  Fingerprint explicit authority fields, never whole mailbox/member row versions
  or sync/billing fields. A cleared same-grant reauth may preserve intent; an
  actual revocation changes version. Recheck live eligibility before granting. Worker checkpoints/completion must pass their captured
  generation, never substitute the transaction's current version. Preview starts
  compare the observed policy and slot ID; exact retries reuse the retained
  result, and replacements receive a new server-generated ID.
  Source events page raw contact/company rule references before filtering active
  revisions. Wire event insertion inside the source edit's existing transaction;
  preserve its lock order and never enqueue as a separate post-commit effect.
  Bulk teardown must keep withdrawal available: plain deletes on the no-rule
  path, then one fresh team-reference probe/coarse event; referenced deletes
  return IDs and recheck references in a new statement. Activation locks and
  revalidates live targets. Never add a team privacy lock around bulk teardown.
  `domain/email_policy_work.rs` and its service own generation-bound history:
  raw contact pages of 100, sent-first passes, effect reauthorization and exact
  cursor completion. Source reconciliation uses stable retry receipts and system
  audit entries; matching edit hooks live in `email_policy/source_changes.rs`.
  Add the same transactional hook to any new address/domain/visibility writer.
  `email_policy_preview.rs` owns count-only work: one retained owner slot,
  stable read-only snapshot, raw pages of 100, 10,000-thread/five-minute budgets
  and conditional completion. Previewing never initializes consent. Matching
  edit hooks invalidate preview metadata; no mailbox index is added for counts.
  No worker initializes consent or activates selected contribution.

- A company merged away keeps answering to its old id through
  `crm_company_aliases`: the `/crm/companies/{company_id}` routes, the company and
  pipeline tools, a contact's company, record associations and `/crm/previews`.
  The company extractor and `company_receipt` mint the receipt for the company
  the id names now, so act on the receipt's id, never on the path or argument.
  Previews stay keyed by the requested id and name the other in `mergedInto`.
  Soup and search filters match company ids as given.

- Company lists with at most 500 explicit IDs and policy target reads probe the
  primary key behind `OFFSET 0` before applying team/visibility filters. Keeping a team
  predicate inside the probe lets stale plans scan the team per ID. For target
  locks, resolve authorized IDs first, then lock that set in ID order; a locking
  lateral can lock foreign rows before its outer filter and sort. Larger company
  ID sets keep their set-based join; the output page limit does not cap input IDs.

- A generic pipeline has `record_type: None` and an unprotected primary column,
  which can change type or be deleted, leaving `primary_column_id` naming no
  column; `referencing_rows` reads tracked pipelines only. Don't add `ON DELETE`
  actions touching the pipeline row: they wait on the row lock the write guard
  holds, and the request hangs.
- The Pipelines card (`entries`) starts from the records: `referencing_rows`
  reaches primary cells through `idx_ep_database_row_references_gin` (keep its
  literal `entity_type`/`type` predicates, the guarded uuid cast, and the
  materialized CTE that keeps a generic plan from probing once per pipeline),
  grants are read for the holding pipelines only (`get_pipelines_access`, fenced
  per pipeline), and one `lock_live_many` guard
  covers every pipeline while `storage_tables_rows` reads their columns and
  cells. Never start it from the viewer's pipelines or lock them one at a time:
  that cost grew with every pipeline the viewer can see.
- Pipeline board-position reads require a pipeline View receipt, hold its live
  lifecycle guard, and scope the view to its backing table/database through
  `DatabaseStorage::storage_view_positions`.
- `src/domain/generic_email_domains.rs` filters both manual company creation
  and email-driven contact population. Cover legitimate company-domain
  exceptions with regression tests when correcting the blocklist.
- `resolve_association` also accepts `CrmAssociation::Activity`: all records in
  teams within the viewer/verified-bot scope, excluding hidden rows
  even for admins. Preserve distinct contact IDs that share an email; returned
  domains and addresses constrain the viewer's mailbox, not team email access.
  `activity_property_edges` returns the items whose Companies or Contacts
  property names a record of the same scope: it reads only the scope's visible
  company and contact ids and probes each property's partial GIN index once
  per id, so its cost follows the scope's records (about 2.6 us and 2.4
  buffers each warm: 38 ms for 4k companies and 10k contacts), never other
  teams' property rows. Keep each probe a fenced lateral: as a plain join, a
  selective kind filter flipped the plan into testing every record against
  every property row (1.8 s). Revisit if a team's records near 40k (100 ms).
  Keep its visibility rules identical to the Activity arm's. It reads the
  pool `with_activity_edges_replica` names, the replica for DSS's list Soup,
  after checking the viewer's current permitted teams on the primary. Record
  data lags like the rest of a list: a record hidden moments ago can still
  match, and a record just added may not yet. Membership removal and CRM access
  revocation take effect on the next request. Each item still passes its own
  source's access check. Every other CRM read and write stays on the primary.
- An archived call links to the companies whose domain a participant's address
  is at, and separately to every visible contact of the team holding the
  address as any of its addresses, with or without a company, together with
  that contact's company (`src/outbound/call_link.rs`). A contact under a
  hidden company links neither, and a team's own members never match its CRM. Calendar events and
  bookings have no link by attendee address: they reach a record only through
  a Companies or Contacts property someone set, a reference, or the call held
  for them.

- Manual companies require a name and accept an optional domain; explicit
  contact creation accepts any valid email, including personal providers.
  A contact created without naming a company (`create_team_contact`: New
  contact, `POST /crm/contacts`, the SDK, the CreateContact tool) is filed by
  its email domain as population files one: under the team's company for the
  domain, created when missing (no name of its own, not `manually_created`,
  directory entry ensured first). It stays without a company for a personal
  or generic provider, a blocked domain or a hidden company, and records no
  mailbox source. Do not apply manual
  creation rules to capture/consent; see `docs/design/crm-contact-creation.md`.
- Contacts created before that rule are filed only by an operator:
  `POST /internal/crm/teams/{team_id}/file-unfiled-contacts`
  (`domain/contact_filing.rs`, internal credentials, mounted by storage) files
  one batch of a team's `manually_created` contacts without a company (a
  contact sync left without one, or an archived one, is counted and skipped;
  sync never creates a company for an archived contact) by the
  same rule, under a contact edit's locks, paging by address along
  `crm_contacts_unfiled_email_idx`, and returns counts per outcome.
  It defaults to a dry run and is safe to repeat. Never call it from a worker
  or a migration: one import can hold thousands of domains.
- `GET /crm/companies/by-domain` (SDK `crm.companyByDomain`) resolves the
  team's company for one domain through `crm_domains_team_id_lower_domain_unique`
  and reads it as `GET /crm/companies/{id}` does, without contacts; a member
  gets nothing for a hidden company. It is exact and current, unlike the
  indexed company search, so agents use it after a duplicate-domain 409.
- Contact setters add or remove an address, choose the primary, link a first
  company for any contact without one, switch company for a personal-provider
  primary, or unlink a company; the rules live
  in `src/domain/contact_update.rs`. Validate under the contact lock and reject
  same-team duplicates without disclosing restricted matches. A new address
  must be free across the team; a link, switch or unlink re-checks every
  address the contact holds. Preserve ID, archive and sources.
- Company domain setters (`domain/company_domains.rs`, `PUT`/`DELETE
  /crm/companies/{id}/domains`, the `AddCompanyDomain` and
  `RemoveCompanyDomain` tools) add or remove one of a company's
  `crm_domains`, validated under the exclusive team privacy lock, the
  domain's lock and the company row. Any member who can see the company may
  edit; a domain another company of the team tracks is refused
  (`CompanyDomainTaken`, naming it only to a caller who can see it). An
  added domain is dated after every domain the company holds, so the
  primary domain and the name never change; the primary that names a
  company without a team name can't be removed. A company whose sync is off
  keeps its domains out of sync, so adding one passes the mailbox-domain
  guard and removing one is admin-only and schedules history. Edits mark
  the company `manually_created`, record a company matching change, never
  attach existing contacts, never delete contacts or mail, and write the
  directory only through `ensure_domain_directory_entry`, as creation does.
- A company-domain contact has a company and an address on one of that
  company's `crm_domains` (`CrmContact::company_domain_emails`; there is no
  stored marker). It cannot be unlinked or moved, and its last such address
  cannot be removed. Read queries and the edit path compute it with the same
  SQL expression; keep them identical.
- Removing an address deletes only its `crm_contact_emails` row. Mailbox sources
  stay, removed addresses are not remembered, and later mail from one may file a
  fresh contact. Removing the primary promotes the oldest address left.
- Personal sync and cleanup resolve one same-team/email contact across all companies,
  including hidden rows; skip ambiguous identities and preserve manual company choices.
- Serialize single and bulk source teardown company-before-source/contact, and
  re-read the target after waiting; orphan deletion must not cascade a new manual link.
- CRM availability requires current membership and effective `team_user.crm_access`;
  admins/owners always qualify. Recheck `CrmTeamReceipt::check_access` on CRM
  record and shared-setting operations; aggregate Soup/search paths return no
  denied records. Entity receipts and requester-side email grants use the same
  primary-backed predicate.
  Contribution consent is independent and remains manageable after CRM denial.
  Team preference writes remain disabled by the rollout gate until old removal
  writers have drained; that gate never weakens these read checks.
  `/crm/member-access` reads authority even for a denied viewer; storage's response
  opt-in response hint lets an open client retire stale snapshots. Only that
  hint has a three-second per-instance cache; receipts and the authority endpoint
  stay fresh. See `docs/CRM_EMAIL_PRIVACY.md` for the request header and latency.
  Client retirement is shared by the browser/native cache owners in
  `soup_filter_cache_adapter::permissions`; preserve authored queue state while
  removing copied response content, including derived mail and property records.
- Population is independent of the contributor's CRM viewing permission.
  Population takes the shared `crm-email:{team}` advisory lock, then the
  `crm-contact:{team}:{link}:{email}` lock (which `depopulate_contact` also
  takes before its domain lock), parent team `KEY SHARE`, an unlocked admission
  probe and mailbox scan, then fresh mailbox/member/consent guards before the
  domain advisory lock and entity rows. Never hold the mailbox row lock through
  the history scan: overlapping populations can starve an exclusive sync writer.
  Recheck live mailbox, membership and captured consent generation after the scan
  in `READ COMMITTED`; keep the privacy/contact guards across both phases so
  exclusions and teardown cannot invalidate its results. Check the two message
  witnesses and matched contacts by primary key after authority: changed evidence
  returns `Contended` for an unlocked retry, never a history scan under the row
  guard. This neither re-evaluates a witness thread's privacy rules nor freezes
  other mailbox history. Never run the mailbox
  scan under a domain lock: a team backfill queues every population of the domain
  behind it. Population transactions set a five-second `lock_timeout` and
  return `CrmError::Contended` so their job is deferred, not held. Privacy changes
  take the exclusive privacy lock before domain/entity locks. Keep locks through
  commit; never wait on a domain or privacy lock after acquiring CRM entity
  rows. Only shared team, mailbox and member row locks may precede a domain lock,
  and no domain-lock holder may lock those rows exclusively.
  A population scans the address history once, inside that transaction:
  `may_contribute_contact` is admission only, `populate_changes_nothing`
  skips a company-domain job before any scan, and a personal-provider address
  the team keeps out is refused before it. Email sync queues a job per message and
  address, so a busy contact's jobs are mostly duplicates; a scan ahead of the
  no-op check ran for each of them and hit the 15-second cap on large mailboxes.
  Manual creation retains domain/parent/entity ordering without email consent.
  Contact field edits take exclusive privacy coordination before discovery/domain
  locks because reassignment changes contribution eligibility; they never require
  consent or enable sync. Assigned personal contacts under disabled parent sync
  retain their identity/company but receive no email-derived source/history writes.
  Legacy enable is a compatibility no-op; disable/purge is retired.
- Bound pipeline read- and write-guard waits, and contact population lock waits,
  with a transaction-local five-second timeout so waiters release pool
  connections needed by the holder's work.
- When depopulating an email, prefer its domain-linked contact over a manual
  unfiled record so mailbox-source teardown reaches the synced contact.
- Thread exceptions live in `crm_email_thread_exclusions`, scoped to one
  team/member/mailbox/thread; mutations, paginated listing and the optional
  `thread_id` lookup on that list are owner-only. The optional `consent_only=true`
  projection on `GET /crm/email-privacy` reads only the current mailbox and
  effective consent, with the same authorization and 15-second read timeout;
  leave domain-list queries on the full settings path. Exact lookup returns zero or
  one row without a cursor through an indexed owner lookup; reject it with
  `after`.
  Keep these contribution controls available to members denied CRM viewing,
  like mailbox consent; use membership authority without `check_access`.
  Require `enable-crm-thread-exclusions` in the domain before set/clear, failing
  closed when unavailable; keep rollout off until ingestion and Team email readers
  understand exceptions. Keep `crm_email_thread_excluded`, the Team reader's
  `ALLOWED` rule and the set-based interaction scan in parity.
  Another contributor's copy remains eligible. Restore queues backfill; exclusion
  preserves records and prior interaction dates, like personal blocked domains.
- Domain exclusions affect contribution and CRM email reads, never record
  visibility. Preserve archive state on block/unblock and consent withdrawal.
  Apply `domain/email_privacy/mailbox_domains` before every new exclusion:
  team blocks (including company sync-off/archive) protect all members' connected
  primary mailboxes; personal blocks protect the caller's. The adapter gathers
  and locks mailbox facts before domain/entity locks and invokes domain policy
  within the write transaction. Full settings report existing matches without
  removing them; consent-only and the three eligibility readers stay independent.
- Keep ambiguous CSV contact lookups unresolved without creating records for
  them; continue valid rows, but propagate lookup storage and authorization failures.

- `POST /crm/previews` titles up to 100 companies and 100 contacts in one
  read for web chips (`src/outbound/companies_repo/previews.rs`). It must
  answer each record as `GET /crm/companies/{id}` and `GET /crm/contacts/{id}`
  do (current membership and effective CRM access; members see no hidden company, hidden contact, or
  contact under a hidden company; the name and first domain the read returns,
  domains ordered by `created_at`, then id), and leave out any record the
  reads refuse (401, for a missing record too). Change both together;
  `companies_repo/test/previews.rs` compares them for every role and caller,
  including revocation and regrant on the same session and contact-page route.

- Keep team/visibility filters outside the per-history-ID `LIMIT` in
  `list_companies_for_soup.sql`, so stale team estimates cannot replace the
  `crm_companies_id_text_idx` lookup with a team scan for every viewed record.

- Company names/logos live in the global `crm_domain_directory`. Only the
  email pubsub workers carry a real `CompanyMetadataResolver`, using public
  homepage metadata through `unfurl`; every other
  binary uses `NoOpCompanyMetadataResolver`, which leaves a pending entry
  (NULL `enriched_at`) that `CrmServiceImpl::enrich_pending_domains` resolves
  later with bounded retries. Never store an empty entry for a domain no
  resolver answered for: resolved entries are permanent.
- Apollo enrichment has been removed. Historical provider fields in the
  directory remain readable; do not clear existing metadata or drop columns
  as part of provider removal.
- Contacts carry their own `team_id`; `company_id` and `email` are optional.
  Scope contact reads by `ct.team_id` and LEFT JOIN the company for its
  `hidden` flag and name. Email sync files personal-provider addresses
  (`is_personal_email_domain`) as company-less contacts when no identity exists and the team
  turns `exclude_personal_emails` off; `crm_blocked_domains` stops sync per
  domain. CRM-scoped previews accept eligible company-less contacts using
  their team and email address. Company-less contacts add no independent
  thread-access grant, but hidden ones suppress their team's
  CRM-derived grant for members; independent access grants still apply.
  For a work address whose sole holder is a manual unfiled contact with that
  primary address, sync refreshes the existing contact and preserves its company
  choice. Domain company population still runs on its own.
- Every address a contact is known by is a row in `crm_contact_emails`, stored
  trimmed and lowercased. `crm_contacts.email` is the primary address, and a
  trigger records it in that table. Find a contact by address through
  `crm_contact_emails` (sync, teardown, email scope, thread access, call
  linking, the activity scope); read `crm_contacts.email` only to display the
  primary. Contact search and listing still match the primary only.
  The table has no team column, so a read by address starts from the address
  index and a read by team probes it once per contact: keep both behind their
  `OFFSET 0` fences, or the planner joins against every team's addresses.
  Company-domain population still
  upserts on company and primary, but first looks for a contact that holds the
  address as a further one and refreshes it instead: under the domain's
  company, or anywhere in the team when nobody is filed under the domain with
  it. A mailbox source is recorded per contact and mailbox, not per address:
  `depopulate_contact` keeps it while that mailbox still has mail with another
  of the contact's addresses (`other_address_mail.sql`), checked before the
  domain lock like population's mailbox scan. Mail the provider no longer has
  (`provider_missing`, an Outlook deletion) counts nowhere: not there, not in
  the email service's cleanup gate, not in `interactions.sql`; keep the three
  in step, as a Gmail deletion removes the row.
- The Sales migration (`SALES_BACKFILL.md`) is forward-only and additive —
  its down migration refuses to erase completion or user edits; never revert
  it to undo a bad migration, only the application code that reads it.
- The pipeline `edit` route refuses `sharing` from a scoped agent session
  (`agent_correlation::context::refuse_sharing`, 403); a new sharing field
  joins that check.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `database-core`
