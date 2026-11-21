# soup

## What it is

Backs the Home, Recent, Signal/work-feed, and GraphQL Soup query surfaces.
Soup is the amalgamated query service: callers filter across many entity
types (documents, channels, chats, calendar events, agent sessions, database
rows, initiatives, ...) and get back a single unified, paginated result.

## Start here

- `src/domain/service.rs`: the main query service; `src/domain/ports.rs` for
  its repository/collaborator traits.
- `src/domain/models.rs` (+ `grouping.rs`, `exclusions.rs`, `contact_listing.rs`):
  the unified `SoupItem`/grouping/exclusion shapes.
- `src/domain/models/sort.rs`: property/timestamp sort descriptors and ordinary
  position cursors; timestamp encodings remain backward-compatible.
- `src/domain/service/favorites.rs`, `agent_metadata.rs`: entity-kind-specific
  query logic layered onto the core service.
- `src/outbound/pg_soup_repo.rs`: the Postgres repo, split by entity kind
  (`database_row.rs`, `calendar_event.rs`, `agent_session.rs`, `initiative.rs`,
  `harness.rs`, `team.rs`,
  `attention.rs`, `notified.rs`, `touched.rs`) and by shape
  (`expanded/` hydrated, `unexpanded/` id-only).
- `src/inbound/axum_router.rs` + `src/inbound/toolset/list_entities.rs`: the
  HTTP route and the AI-tool surface over the same service.

## Scope

- Owns: cross-entity filtering, sorting, grouping, exclusion, and pagination
  logic, and the Postgres queries that back it.
- Not here: how a specific entity type is created/edited (channels, documents,
  initiatives, ...); per-entity-type cache projection → `soup_filter_projection`;
  realtime fan-out of Soup patches → `soup_realtime`.

## Boundaries

- Depends on: `entity_access`, `properties`, `crm`, `item_filters`,
  `filter_ast`, `favorites`, `frecency`, `channels`, `email`, `call`,
  `github_pull_requests`, `foreign_entity`, `activity`, `agent_changes`.
- Used by: `ai_tools`, `attention_feed`, `complete_graph`, `databases_sql`,
  `graphql_initiative`, `graphql_soup`, `graphql_work_feed`, `memory`, `skills`,
  `soup_filter_projection`.

## Recipes

- Add a new queryable entity kind: `src/domain/models.rs` (variant) →
  `src/outbound/pg_soup_repo/<kind>.rs` (expanded + unexpanded if both apply) →
  `src/domain/service.rs` wiring → `src/domain/ports.rs` if a new
  collaborator is needed.
- Add a filter/sort option: `item_filters`/`filter_ast` (the filter language) →
  `src/domain/models.rs` → the matching `src/outbound/pg_soup_repo/*` query.
- Change which candidates attention feeds (Home's work feed, the
  notifications inbox) page:
  `src/domain/service/tests/attention.rs` → `src/outbound/pg_soup_repo/attention.rs`
  (`attention/query.sql`). Channel-thread keying applies only to
  `AttentionKeying::ThreadScoped`; keep it in step with `attention_feed`'s
  `keying.rs`. A read of known items (`only`) under `FiledEntity` keying
  takes its pending notifications from `attention/pending_only.sql`, by key;
  every other read, and every probe (which empties it), takes them from
  `attention/pending.sql`. Change both.
- Find where a viewer's unread rows may be without paging a feed:
  `src/outbound/pg_soup_repo/attention_unread.rs`. It is neither gated nor
  filtered and runs for every signed-in viewer; its two reads are bounded by
  their `limit` and must stay so.
- Give a kind with no list of its own (runtimes, teams) inbox rows: an
  attention-only kind like `pg_soup_repo/harness.rs` or `team.rs`, a gate in
  `attention/query.sql`'s attention stream only, a by-ids leg, and the type in
  `requested_types` (as CRM records are).

## Tool contracts

- The AI `ListEntities` adapter includes agent sessions and excludes legacy chats; public feed contracts retain historical chat support.

## Checks

- `cargo test -p soup --features outbound` (`SQLX_OFFLINE` unset; needs local
  MacroDB). Without the feature the Postgres repo and its tests don't compile.
- After schema/query changes: `nix develop --command just prepare_db` (see `justfile`).
- `cargo clippy -p soup --no-default-features`, and again with `--features ports`
  (both run in `just clippy` and CI): most dependents build soup without
  `outbound`. Gate a domain helper on the feature its callers compile under:
  `ports` for `domain/service`, `outbound` for the Postgres repository.

## Gotchas

- `AttentionCandidateRequest::assume_attention` probes the attention query:
  each `only` key counts as if a notification about it were pending, so a
  caller can ask whether a new notification would be listed. A probe never
  reads the viewer's pending notifications, so its cost stays flat however
  many they have (`a_probe_costs_the_same_however_many_notifications_are_pending`;
  past Postgres's JIT threshold a probe took hundreds of milliseconds).
  Normal pages build byte-identical SQL (`only_a_probe_changes_the_query`).

- Project grouping uses the system Project property (initiative membership),
  including canonical TASK assignments, rather than legacy folder `project_id`.
  `SoupService::group_labels` names the groups a grouping field leaves
  unlabeled (today, project groups, from the initiative names the caller can
  read); REST group meta and GraphQL bins carry the result as `GroupLabels`,
  and a key it leaves out keeps itself as its label.

- Attention feeds admit visible CRM records through current team membership,
  independently of mailbox contribution consent or the retired team CRM switch.
  Hidden companies, their contacts, and hidden company-less contacts stay out.
- Preserve email-rule resource failures as HTTP 503 with the named limit; do
  not turn a failed CRM Team email read into an empty or partial Soup page.
- `crm_association.rs` resolves CRM scope before filtering, sorting, and paging.
  Activity uses property edges rather than references and matches email within
  the caller's mailbox. It reads only what the request's sources can return
  (`ActivityReads`): a source pinned to the nil id (`exclusions`) reads
  nothing, so each Sales view reads one source, and the edges come from one
  statement that probes the Companies and Contacts property indexes with the
  scope's record ids (`CrmService::activity_property_edges`), without its
  domains, addresses or database rows. A request that reads database rows
  still takes the record path. Keep browser requests bounded; never expand
  every CRM record into client-side filters or raise ingress limits to fit
  them.
- Property edges reach database-row cells from the requested records through
  `idx_ep_database_row_references_gin`: keep that arm's literal
  `entity_type = 'DATABASE_ROW' AND values->>'type' = 'EntityReference'` so the
  partial index applies, and join the row by the guarded uuid cast, never
  `r.id::text = ep.entity_id`, which reads every row cell of every database.
  Keep both of its `OFFSET 0` fences as well: joined plainly, the planner
  started from every entity definition and compared all of their cells with
  every record, from about 500 records with fresh statistics and for a single
  record once they were stale, and the statement ran into its timeout.
- Property edges reach a task's custom entity properties from the requested
  records through `idx_ep_crm_record_references_gin`, for a company or contact
  scope only (`custom_task_properties`; the activity scope reads the built-in
  properties). Keep that arm's copy of the index predicate, without which the
  index cannot apply, and both `OFFSET 0` fences: joined plainly, the planner
  started from every custom entity definition and read all of their values
  once statistics were stale or the scope named more than about ten records.
  The arm does not check who owns the property: a task shows every property
  set on it to whoever can open it, and the document arm still checks access
  to the task.

- A `crm_domains` (`ecd`) scope that email rejects as not found or not
  permitted (archived company, email sync off) leaves email threads out of the
  page instead of failing it; `handle_email_request` matches those two errors
  only. Email's precheck is the only gate on the team-wide widening, so never
  drop just the failing domains and keep the scope.
- Agent sessions named by id (an `Id` literal in `cursor_soup`, which GraphQL
  `agentSession` and its log use, and `by_ids`) also accept a grant on the
  document or call whose live thread the session runs in, and the session's
  public or team link share, matching `entity_access`. Broad lists use
  session grants only, and leave out
  `hidden` sessions (thread-started, DM contexts) except for their followers
  (`agent_session_follower`, people who prompted the session from the session
  itself), who may also read them through the thread's parent. The notified
  and work feeds share that rule through `notified::agent_session_gate`.
- A source pinned to the nil id (how CRM tabs, Home, Tasks, and GraphQL
  hydration leave a source out) runs no statement: `exclusions.rs` drops the
  email, channel, channel-thread (by thread or channel id), call, and
  foreign-entity requests, the calendar and agent-session legs return early,
  and a dynamic query that can return no row (`DynamicArms::can_match`) skips
  its transaction and source-id read. A project parent pinned to nil counts
  only there: a union with another live arm keeps that project arm, because
  dropping it leaves one read of `TopItems`, Postgres inlines the CTE, and
  CRM record Files then scanned `document_sub_type` once per page row.
  The CRM company request is dropped when the ids its extractor collects are
  all nil, read from the extract because it unions `And`ed ids; a
  hidden-company request keeps the leg so the admin check still answers it.
  Prove a new pin impossible the same way; `nil OR real id` must keep its leg.
- `expanded/` vs `unexpanded/` queries exist because hydrating full entities
  is expensive — don't widen `unexpanded` to return hydrated data; add a new
  `expanded` path instead.
- Extend the existing dynamic query for property sorts and date-range groups; do not rebuild its source UNION in a candidate pipeline.
- Keep property definition IDs unchecked like existing filters/grouping; enforce item visibility through the existing source access gates.
- Order property pages by typed key with explicit ASC/DESC and NULLS LAST, then update timestamp and descending ID; keep timestamp SQL unchanged.
- Validate caller DATE ranges in REST/GraphQL input conversion; render typed UTC bounds with `to_rfc3339()` and map numeric range indices to caller keys in Rust.
- Preserve projection-backed hydration, the UUID-keyed item/fact pools, and per-group total/has-more metadata through the shared grouped response.
- Flat property sorts omit calendar events, email, channels, calls, companies, and agent sessions; grouped reads retain calendar events and timestamp queries retain their existing sources.
- The `Name` sort rides the same selected-sort path: each union arm contributes `lower(<its name column>) COLLATE "und-x-icu"` as `sort_name`, hydrated rows order on their own `name` through the same `name_sort_key`, and the cursor carries the stored spelling SQL lowers again. ICU root, not the libc default, so the web's `compareSoupNames` (`localeCompare(…, 'und')`) shows the order the pages arrive in. An empty name sorts first ascending; database rows have no name there and sort last.
- Preserve deployed timestamp cursor encodings; client query keys restart pages when ranges or selections change.
- Keep flat timestamp top clauses lightweight; bind the caller's source ids, then document-ID arrays, after the sort's fixed parameters and skip subtype namespace joins when the filter proves TASK-only unless other predicates need them.
- The dynamic query's document, chat, and project arms match `entity_access.source_id = ANY(<bound source ids>)`, not a join to the `user_source_ids` CTE: Postgres costs a CTE join at the average source's grant count and probed the item table once per grant for callers holding hundreds of thousands. The query runs in a transaction that raises `parallel_setup_cost`, because parallel plans made callers with a few thousand grants twice as slow.
- Those statistics list only the largest sources and estimate every other one at the table's average, so a caller in a few hundred channels was planned as a hash join over a scan of every live document. The document arm counts the caller's document grants first (`DocumentGrants::count`, up to `COUNTED_DOCUMENT_GRANTS`) and, under the limit, reads the distinct granted ids behind an `OFFSET 0` fence with the count as the `LIMIT` (`counted_document_access_semi_join`): a constant `LIMIT` is the estimate Postgres takes as given. `begin_dynamic_query` opens a `REPEATABLE READ` transaction so the count and the gate read the same rows and the `LIMIT` never drops one. Keep the fence: `DISTINCT ... LIMIT` without it walked an entity-ordered index over all of `entity_access`. Callers over the limit, named-id arms, and arms that require a folder or a notification (`requires_a_folder_or_notification`, which Postgres reads from those few documents first) keep the estimated gate; chat and project arms keep it too, their tables being small enough to scan. Re-measure on a production-size seed with `source_id` statistics pinned to production's per-source estimate before changing the limit or the exceptions.
- A document arm whose filter admits only ids it names, at most `MAX_NAMED_CANDIDATES` of them (`named_document_bound`: CRM Tasks, Notes, References) checks access after its own filters (`DocumentArmAccess::AfterFilters`): the candidates and their sub-type, file-type and property filters sit behind an `OFFSET 0` fence, the `properties_filter` `EXISTS` run once per candidate (`PropertyProbe::PerCandidate`) instead of as a bitmap over every row the property holds (a `DocumentLiteral::Property` inside the document filter keeps `PropertyProbe::Planned`), and each survivor probes `entity_access` by uuid over its two partial unique indexes, in page order and past the cursor so a flat timestamp page stops at its `LIMIT`. Broad arms and longer lists keep the semi-join. An id OR'ed with any other literal does not bound the arm.
- OR'ed select options of one definition and entity type render as one `EXISTS` over `?| ARRAY[...]` (`option_membership_predicate`), always fenced with `PER_CANDIDATE` whatever the `PropertyProbe`: unfenced, Postgres pulls that single `EXISTS` up into a semi-join and drives a broad list (the Tasks view, every task by status) from the property index's matches across every entity, about ten times slower warm and a full read of every matching task cold.
- Read grouping/sort definition types through uncorrelated scalar lookups; join grouping options once outside the value expansion and preserve missing-option groups.
- Build option-sort order maps with an uncorrelated `jsonb_object_agg` lookup using the sort definition bind; ignore unknown option IDs and keep unknown-only values missing.
- Materialize grouped `TopItems` only for property sorts so the sort key is computed before multi-value group expansion; leave timestamp CTEs inlineable.
- With `with_source_items_enabled`, flat listings read document, chat and
  project candidates from the trigger-maintained `source_items` table
  (`expanded/dynamic/feed.rs`) instead of the item tables, per arm, under a timestamp sort `source_items`
  can order (not `CreatedAt`, property or name sorts) when the arm's filter lets a source scan stop at the page (`served_by_scan`) and does
  not fold to false (`matches_nothing`, over the `*_literal_constant` functions
  beside each renderer). A page with a projected arm first asks for the bound
  (`ScanBound`, one query): the whole query reads the item tables unless
  `source_items_exact()` holds (triggers on, backfilled since), so a stale or
  empty table costs speed, never access; and, for in-order scans, when the
  session is not UTC or, for source scans, the user's sources exceed
  `SOURCE_SCAN_SOURCES` or `SOURCE_SCAN_ROWS` / page size. With the projection
  disabled no arm is projected and nothing extra runs. The projected arms
  check access against the same bound source ids as the item-table arms
  (`fetch_user_source_ids`); never restate the source rule in SQL. Both paths
  must return identical pages: the query test helper installs the triggers,
  backfills the table from the fixture, audits it, and runs every case on both.
  Feed tests load `fixtures/source_items_triggers.sql` first, which installs
  the triggers whatever the migrations did and marks the empty table
  backfilled. Rollout: `SOURCE_ITEMS_ROLLOUT.md`.
- `candidate_gates.rs` encodes access-gate SQL shared across repo queries;
  changing it changes what every entity kind can return.
- Keep the notified feed's notification lookup behind a lateral `OFFSET 0`
  fence so the caller's `user_notification` rows drive the join; aggregate the
  latest notification before applying the cursor or notification-state gates.
- A notification-state conjunct drives a listing from the caller's
  notifications (`strip_notification_conjunction`, which folds `(unseen OR
  seen) AND unseen` to `unseen`): the dynamic query joins `NotificationItems`,
  the calendar leg semi-joins `notified_event_ids_sql` over
  `idx_user_notification_viewer_entity`. The per-row `EXISTS` fold stays only
  for trees the stripper rejects; on the calendar leg it seq-scanned every
  event in the table.
- Calendar access is `owner_id = $1 OR source_link_id = ANY(ARRAY(...))`, not
  an `EXISTS` over `macro_user_links`, so the planner can index both sides of
  the OR.
- Queries over a known id list (`*/by_ids.rs`, hydration, candidate gates
  such as `initiative_gate`) check access per row with `EXISTS` on
  `entity_access`, matching sources with `= ANY(ARRAY(SELECT ...))` so they are
  collected once rather than semi-joined per row; cost follows the ids passed
  in. A gate `EXISTS` also needs `PER_CANDIDATE`, or Postgres hashes it back
  into the caller's whole accessible set.
- The initiative listing starts from the caller's access instead
  (`INITIATIVE_LISTING_ACCESS`): one `(source_id, entity_type, entity_id)`
  index descent per source returns only that source's initiative grants, and
  the owner's team link is reached through the caller's own `team_user` rows,
  checking every initiative their teammates own. The set and the teammates are
  collected with `= ANY(ARRAY(...))`, which keeps `initiative` on its indexes
  under stale statistics; a plain `IN` or join was planned as sequential scans
  of `initiative` there. The per-row form
  tests every initiative in the table, each against every source. Never match
  `team_user.team_id::text` against the source array: no index serves it, so
  it reads all of `team_user`. A filter that names its ids (GraphQL
  hydration, and the nil id every other hydration passes) keeps the per-row
  form (`names_initiative_ids`): the set costs a descent per source even when
  one row comes back. Detail joins compare the bare uuid
  (`i.id = (CASE ... END)::uuid`); `i.id::text = t.id` read the table once per
  page row.

## Related

- Skill: `database-core`, `cloud-storage-hexagonal-architecture` · Rules:
  `.agents/rules/rust/db.md`, `.agents/rules/rust/architecture.md`

- CRM list, association, and attention visibility includes effective per-member CRM access; team membership alone is insufficient. Current primary-backed gates also protect cached-source reads.
