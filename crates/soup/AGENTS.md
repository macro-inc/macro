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
  `harness.rs`,
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
  `keying.rs`.
- Give a kind with no list of its own (runtimes) inbox rows: an
  attention-only kind like `pg_soup_repo/harness.rs`, a gate in
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

- Project grouping uses the system Project property (initiative membership),
  including canonical TASK assignments, rather than legacy folder `project_id`.
  `SoupService::group_labels` names the groups a grouping field leaves
  unlabeled (today, project groups, from the initiative names the caller can
  read); REST group meta and GraphQL bins carry the result as `GroupLabels`,
  and a key it leaves out keeps itself as its label.

- Attention feeds admit visible CRM records through current team membership,
  independently of mailbox contribution consent or the retired team CRM switch.
  Hidden companies, their contacts, and hidden company-less contacts stay out.
- `crm_association.rs` resolves CRM scope before filtering, sorting, and paging.
  Activity uses property edges rather than references and matches email within
  the caller's mailbox. It reads only what the request's sources can return
  (`ActivityReads`): a source pinned to the nil id (`exclusions`) reads
  nothing, so each Sales view reads one source, and the edges come from one
  statement over the Companies and Contacts property rows
  (`CrmService::activity_property_edges`) instead of every record's ids. A
  request that reads database rows still takes the record path. Keep browser
  requests bounded; never expand every CRM record into client-side filters or
  raise ingress limits to fit them.

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
- Read grouping/sort definition types through uncorrelated scalar lookups; join grouping options once outside the value expansion and preserve missing-option groups.
- Build option-sort order maps with an uncorrelated `jsonb_object_agg` lookup using the sort definition bind; ignore unknown option IDs and keep unknown-only values missing.
- Materialize grouped `TopItems` only for property sorts so the sort key is computed before multi-value group expansion; leave timestamp CTEs inlineable.
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
