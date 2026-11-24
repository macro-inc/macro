use crate::api::search::simple::filter::{
    EmailSearch, FilterVariantToSearchArgs, ScopedCalendarEventFilters, email_search,
    reject_unsupported_email_filters,
};
use crate::domain::email_search::ThreadStates;
use crate::domain::search_allowance::{AllowanceDraw, draw_api_key_search};
use crate::domain::search_lanes::{LaneTurn, SearchCaller, SearchLanes};

use crate::api::search::caller::{caller_label, draws_api_key_allowance, search_caller};
use crate::api::search::crm_company;
use crate::api::search::email_operators::{
    QueryClock, apply_email_operators, reported_filters, time_zone,
};
use crate::api::search::simple::{simple_channel, simple_chat};
use crate::api::{
    context::{SearchAuthorizationService, SearchHandlerState},
    search::{SearchPaginationParams, simple::SearchError},
};
use axum::{
    extract::{self, State},
    response::Json,
};
use crm::domain::auth::CrmTeamReceipt;
use entity_access::domain::models::MemberTeamRole;
use macro_authorization::{MacroAuthorizationExtractor, MacroUserAuthentication, UserOrInternal};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model::{response::ErrorResponse, user::UserContext};
use models_opensearch::SearchEntityType;
use models_search::unified::SearchEntityFilters;
use models_search::{
    MatchType, SearchOn, SimpleSearchResponse, TermMatching, unified::UnifiedSearchRequest,
};
use models_search_cursor::{SearchCursor, SearchCursorOption, SearchMethodCursor};
use opensearch_client::search::agent_sessions::{AgentSessionSearchArgs, AgentSessionSearchMode};
use opensearch_client::search::call_records::CallRecordSearchMode;
use opensearch_client::search::documents::{
    DocumentSearchMode, PropertyDateRange, PropertyFilterArg,
};
use opensearch_client::search::model::SearchHit;
use opensearch_client::search::unified::UnifiedSearchArgs;
use std::collections::HashSet;
use tracing::Instrument as _;
use uuid::Uuid;

/// Whether calendar events may appear in this search.
///
/// The flag overrides the request, never the reverse. The AI search tools
/// default `entityTypes` to empty — which means every type — so an environment
/// whose calendar index has not been created and backfilled cannot rely on
/// callers opting out.
fn calendar_events_searchable(requested: bool, flag_enabled: bool) -> bool {
    requested && flag_enabled
}

/// Identifies the source of a search result for cursor regeneration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchSource {
    ChatName,
    ChannelName,
    Content,
    CrmCompany,
}

/// Wrapper for SearchHit that tracks its source for cursor regeneration
struct TaggedSearchHit {
    hit: SearchHit,
    source: SearchSource,
}

/// Find the last TaggedSearchHit matching a given source
fn find_last_of_source(
    results: &[TaggedSearchHit],
    source: SearchSource,
) -> Option<&TaggedSearchHit> {
    results.iter().rev().find(|h| h.source == source)
}

/// Generate a cursor from a TaggedSearchHit.
fn cursor_from_tagged(tagged: &TaggedSearchHit) -> Option<SearchMethodCursor> {
    tagged
        .hit
        .updated_at
        .map(|ts| SearchMethodCursor::UpdatedAt {
            entity_id: tagged.hit.entity_id,
            updated_at: ts,
        })
}

/// Trim the merged, sorted hit list to the first `page_size` distinct entities,
/// keeping every hit of an included entity. The page budget is entities, not
/// hits: a content document expands to one hit per matching chunk and an email
/// thread to one per matching message, so counting hits here lets a single
/// chunk-heavy entity exhaust the budget and short the page.
fn take_first_n_entities(combined: Vec<TaggedSearchHit>, page_size: usize) -> Vec<TaggedSearchHit> {
    let mut page_entities = std::collections::HashSet::new();
    combined
        .into_iter()
        .filter(|tagged| {
            if page_entities.contains(&tagged.hit.entity_id) {
                true
            } else if page_entities.len() < page_size {
                page_entities.insert(tagged.hit.entity_id);
                true
            } else {
                false
            }
        })
        .collect()
}

/// Count distinct entities among `hits` (multiple hits can share one entity_id —
/// content chunks of a document, messages of an email thread).
fn distinct_entity_count<'a>(hits: impl IntoIterator<Item = &'a SearchHit>) -> usize {
    hits.into_iter()
        .map(|h| h.entity_id)
        .collect::<HashSet<_>>()
        .len()
}

/// Computes the next cursor for a search source based on pagination state.
///
/// `included_count`/`original_count` are measured in distinct entities, not hits,
/// so a chunk-heavy source is not falsely judged truncated.
fn compute_next_cursor(
    next_cursor_from_search: &SearchCursorOption,
    included_count: usize,
    original_count: usize,
    last_included_hit: Option<&TaggedSearchHit>,
    original_cursor: &SearchCursorOption,
) -> SearchCursorOption {
    // `included_count < original_count` means the cross-source merge dropped some
    // of this source's entities to stay within the page budget — they must be
    // re-surfaced next page even when the sub-search itself reported Done, so the
    // sub-search reporting Done is not on its own enough to end this source.
    let truncated_in_merge = included_count < original_count;

    if !truncated_in_merge && next_cursor_from_search.is_done() {
        SearchCursorOption::Done
    } else if truncated_in_merge || next_cursor_from_search.has_more() {
        if included_count > 0 {
            SearchCursorOption::NotDone(last_included_hit.and_then(cursor_from_tagged))
        } else {
            original_cursor.clone()
        }
    } else {
        SearchCursorOption::Done
    }
}

/// Where the content source resumes. Email hits that failed the thread state
/// check were read but not kept, so when the merge kept every content hit the
/// next page starts after the last hit read, which can lie past the last hit
/// kept; a page that kept none still moves on.
fn next_content_cursor(
    email_states_checked: bool,
    next_cursor_from_search: &SearchCursorOption,
    included_count: usize,
    original_count: usize,
    last_included_hit: Option<&TaggedSearchHit>,
    original_cursor: &SearchCursorOption,
) -> SearchCursorOption {
    if email_states_checked && included_count == original_count {
        next_cursor_from_search.clone()
    } else {
        compute_next_cursor(
            next_cursor_from_search,
            included_count,
            original_count,
            last_included_hit,
            original_cursor,
        )
    }
}

use crate::api::search::terms::{
    drop_wordless_terms, record_term_counts, resolve_document_term_matching, split_search_terms,
    term_matching_for_cursor, trimmed_query,
};

/// Per-request cap on whitespace-delimited search terms. Each term expands
/// into its own `has_child` clause and is embedded in every clause's highlight
/// query, so query-build cost is quadratic in the term count across the
/// join-shape indices — an unbounded paste can OOM the service.
const MAX_SEARCH_TERMS: usize = 50;

/// Per-term character cap. Body size also scales with summed term length; real
/// tokens fall well under this, so longer ones are truncated rather than
/// rejected.
const MAX_TERM_CHARS: usize = 80;

/// Enforce [`MAX_SEARCH_TERMS`] and [`MAX_TERM_CHARS`] on tokenized terms
/// before they fan out into per-index OpenSearch queries.
fn enforce_term_limits(terms: Vec<String>) -> Result<Vec<String>, SearchError> {
    if terms.len() > MAX_SEARCH_TERMS {
        return Err(SearchError::TooManyTerms);
    }
    Ok(terms
        .into_iter()
        .map(|term| match term.char_indices().nth(MAX_TERM_CHARS) {
            Some((byte_idx, _)) => term[..byte_idx].to_string(),
            None => term,
        })
        .collect())
}

/// Convert request property filters into OpenSearch property-filter args.
///
/// `entity_type` is dropped: the indexed `properties` field carries only
/// `definition_id` + `values`, and definition ids are globally unique, so the
/// entity type adds nothing to the query. Select-option UUIDs and entity-ref
/// ids both match against `values`. Filters with no values are skipped.
fn to_property_filter_args(filters: &[item_filters::PropertyFilter]) -> Vec<PropertyFilterArg> {
    filters
        .iter()
        .filter_map(|f| {
            let values: Vec<String> = f
                .option_ids
                .iter()
                .chain(f.entity_ids.iter())
                .cloned()
                .collect();
            if values.is_empty() && f.date_range.is_none() && f.has_date.is_none() {
                return None;
            }
            Some(PropertyFilterArg {
                definition_id: f.property_definition_id.clone(),
                values,
                date_range: f.date_range.as_ref().map(|range| PropertyDateRange {
                    start: range.start,
                    end: range.end,
                }),
                has_date: f.has_date,
            })
        })
        .collect()
}

const DEFAULT_PAGE_SIZE: u32 = 10;

/// Most OpenSearch pages one request reads to fill a page whose email hits
/// must meet thread states checked in Postgres. A request that reaches it
/// returns what it kept with a cursor past the last hit it read.
pub(super) const MAX_EMAIL_STATE_ROUNDS: u8 = 5;

/// The content hits of one request and where the next request resumes.
struct ContentHits {
    hits: Vec<SearchHit>,
    cursor: SearchCursorOption,
    /// Email hits were checked against thread states, so `cursor` can lie
    /// past hits that were read and dropped.
    email_states_checked: bool,
}

/// Searches OpenSearch from `args.cursor`, keeping only email hits whose
/// thread meets `states` (see [`read_until_page_kept`]).
async fn search_content(
    ctx: &SearchHandlerState,
    user_id: &MacroUserId<Lowercase<'_>>,
    args: UnifiedSearchArgs,
    states: &ThreadStates,
) -> Result<ContentHits, SearchError> {
    if states.is_empty()
        || !args
            .search_indices
            .contains(&models_opensearch::OpenSearchEntityType::Emails)
    {
        let (hits, cursor) = ctx.opensearch_client.search_unified(args).await?;
        return Ok(ContentHits {
            hits,
            cursor,
            email_states_checked: false,
        });
    }

    let email_search = &ctx.email_search();
    let (content, rounds) = read_until_page_kept(
        args,
        |args| async move { Ok(ctx.opensearch_client.search_unified(args).await?) },
        |thread_ids| async move {
            email_search
                .matching_threads(user_id, &thread_ids, states)
                .await
                .map_err(|error| SearchError::InternalError(anyhow::anyhow!("{error}")))
        },
    )
    .await?;

    let span = tracing::Span::current();
    span.record("search.email_state_rounds", rounds.rounds);
    span.record("search.email_state_threads_checked", rounds.threads_checked);
    span.record("search.email_state_threads_kept", rounds.threads_kept);
    span.record("search.email_state_bound_reached", rounds.bound_reached);
    Ok(content)
}

/// What [`read_until_page_kept`] read to fill its page.
#[derive(Debug, Default, PartialEq, Eq)]
struct StateCheckRounds {
    rounds: u8,
    threads_checked: usize,
    threads_kept: usize,
    /// It stopped at [`MAX_EMAIL_STATE_ROUNDS`] with results left and the
    /// page short.
    bound_reached: bool,
}

/// Reads pages from `args.cursor`, keeping every hit but the email hits whose
/// thread `matching` leaves out, until `args.page_size` hits are kept (a page
/// counts hits, one per email message, as an unfiltered page does),
/// the results end, or [`MAX_EMAIL_STATE_ROUNDS`] pages have been read. The
/// cursor returned is the last page's, past every hit read.
async fn read_until_page_kept<Search, Page, Matching, Matched>(
    mut args: UnifiedSearchArgs,
    mut search: Search,
    mut matching: Matching,
) -> Result<(ContentHits, StateCheckRounds), SearchError>
where
    Search: FnMut(UnifiedSearchArgs) -> Page,
    Page: Future<Output = Result<(Vec<SearchHit>, SearchCursorOption), SearchError>>,
    Matching: FnMut(Vec<Uuid>) -> Matched,
    Matched: Future<Output = Result<HashSet<Uuid>, SearchError>>,
{
    let page_size = args.page_size as usize;
    let mut kept: Vec<SearchHit> = Vec::new();
    let mut stats = StateCheckRounds::default();
    let cursor = loop {
        stats.rounds += 1;
        let (hits, cursor) = search(args.clone()).await?;
        let thread_ids: Vec<Uuid> = hits
            .iter()
            .filter(|hit| hit.entity_type == SearchEntityType::Emails)
            .map(|hit| hit.entity_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        stats.threads_checked += thread_ids.len();
        let matching = if thread_ids.is_empty() {
            HashSet::new()
        } else {
            matching(thread_ids).await?
        };
        stats.threads_kept += matching.len();
        kept.extend(hits.into_iter().filter(|hit| {
            hit.entity_type != SearchEntityType::Emails || matching.contains(&hit.entity_id)
        }));
        if cursor.is_done() || kept.len() >= page_size || stats.rounds >= MAX_EMAIL_STATE_ROUNDS {
            break cursor;
        }
        args.cursor = cursor;
    };
    stats.bound_reached =
        stats.rounds >= MAX_EMAIL_STATE_ROUNDS && cursor.has_more() && kept.len() < page_size;
    Ok((
        ContentHits {
            hits: kept,
            cursor,
            email_states_checked: true,
        },
        stats,
    ))
}

/// The span of one unified search. It carries what a slow search is filtered
/// by: who called, the mode, and sizes. The request itself stays off it, since
/// the query and the filter values are whatever the user typed or picked.
fn unified_search_span(
    user: &MacroUserAuthentication,
    query_params: &SearchPaginationParams,
    req: &UnifiedSearchRequest,
) -> tracing::Span {
    tracing::info_span!(
        "perform_unified_search",
        user_id = %user.user_context.user_id,
        search.caller = caller_label(user),
        search.caller_agent = user.agent_id.is_some(),
        search.search_on = %req.search_on,
        search.match_type = %req.match_type,
        search.page_size = query_params.page_size.unwrap_or(DEFAULT_PAGE_SIZE),
        search.entity_types = tracing::field::Empty,
        search.terms = tracing::field::Empty,
        search.dropped_terms = tracing::field::Empty,
        search.email_operators = tracing::field::Empty,
        search.term_matching = tracing::field::Empty,
        search.term_matching_from_cursor = tracing::field::Empty,
        search.email_shared_capped = tracing::field::Empty,
        search.email_project_capped = tracing::field::Empty,
        search.email_state_rounds = tracing::field::Empty,
        search.email_state_threads_checked = tracing::field::Empty,
        search.email_state_threads_kept = tracing::field::Empty,
        search.email_state_bound_reached = tracing::field::Empty,
        search.lane = tracing::field::Empty,
        search.lane_wait_ms = tracing::field::Empty,
        search.lane_outcome = tracing::field::Empty,
        search.rate_limit = tracing::field::Empty,
        search.rate_limit_remaining = tracing::field::Empty,
        search.rate_limit_wait_ms = tracing::field::Empty,
    )
}

/// The entity types a search reaches, as one sorted span value: the
/// OpenSearch indices it queries plus the sources name-searched outside
/// OpenSearch that run.
fn searched_entity_types(
    indices: &std::collections::HashSet<models_opensearch::OpenSearchEntityType>,
    name_sources: &[(&'static str, bool)],
) -> String {
    indices
        .iter()
        .map(|index| index.query_name())
        .chain(
            name_sources
                .iter()
                .filter(|(_, searched)| *searched)
                .map(|(name, _)| *name),
        )
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(",")
}

/// One page of unified search hits, with the CRM receipt the search ran
/// under when it was asked to search CRM.
pub(in crate::api::search) struct UnifiedSearchPage {
    pub(in crate::api::search) hits: Vec<SearchHit>,
    pub(in crate::api::search) next_cursor: Option<String>,
    pub(in crate::api::search) crm_access: Option<CrmTeamReceipt<MemberTeamRole>>,
    /// The email filters the query's typed operators became, if it typed any.
    pub(in crate::api::search) query_filters: Option<item_filters::EmailFilters>,
}

/// Creates a unified search request and performs the search
/// by calling individual simple search endpoints for each entity type
pub(in crate::api::search) async fn perform_unified_search(
    ctx: &SearchHandlerState,
    user: &MacroUserAuthentication,
    include_crm: bool,
    query_params: SearchPaginationParams,
    req: UnifiedSearchRequest,
) -> Result<UnifiedSearchPage, SearchError> {
    let span = unified_search_span(user, &query_params, &req);
    async {
        search_unified_sources(
            ctx,
            &user.user_context,
            search_caller(user),
            draws_api_key_allowance(user),
            include_crm,
            query_params,
            req,
        )
        .await
        .inspect_err(|error| {
            // A limited search is the allowance working, marked on the span
            // by `search.rate_limit`, not a failure to report.
            if !matches!(error, SearchError::RateLimited { .. }) {
                tracing::error!(error = %error);
            }
        })
    }
    .instrument(span)
    .await
}

/// Wait for the caller's turn to search, recording on the current span which
/// lane it waited in, how long, and whether it got a turn. Held until the
/// search ends.
async fn take_search_turn(
    lanes: &SearchLanes,
    caller: SearchCaller,
) -> Result<LaneTurn, SearchError> {
    tracing::Span::current().record("search.lane", caller.lane_kind());
    let turn = lanes.take_turn(caller).await;
    let (waited, outcome) = match &turn {
        Ok(turn) if turn.queued => (turn.waited, "queued"),
        Ok(turn) => (turn.waited, "immediate"),
        Err(refusal) => (refusal.waited, "refused"),
    };
    let waited_ms = u64::try_from(waited.as_millis()).unwrap_or(u64::MAX);
    let span = tracing::Span::current();
    span.record("search.lane_wait_ms", waited_ms);
    span.record("search.lane_outcome", outcome);
    turn.map_err(|_| {
        tracing::warn!(
            waited_ms,
            "search refused: the caller's searches kept every slot busy"
        );
        SearchError::Busy
    })
}

/// Draw an API-key search from its account's allowance, recording on the
/// current span how the draw ended, how many searches are left and how long
/// the bucket took to answer. A limited search is refused before it waits for
/// a turn.
async fn draw_search_allowance(
    ctx: &SearchHandlerState,
    account: &MacroUserId<Lowercase<'_>>,
) -> Result<(), SearchError> {
    let started = tokio::time::Instant::now();
    let draw = draw_api_key_search(ctx.api_key_search_buckets.as_ref(), account).await;
    let waited_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let span = tracing::Span::current();
    span.record("search.rate_limit_wait_ms", waited_ms);
    span.record("search.rate_limit", draw.label());
    if let Some(remaining) = draw.remaining() {
        span.record("search.rate_limit_remaining", remaining);
    }

    match draw {
        AllowanceDraw::Limited { retry_after } => {
            let retry_after_seconds = retry_after.as_millis().div_ceil(1000).max(1);
            Err(SearchError::RateLimited {
                retry_after_seconds: u64::try_from(retry_after_seconds).unwrap_or(u64::MAX),
            })
        }
        AllowanceDraw::Allowed { .. } | AllowanceDraw::Unavailable => Ok(()),
    }
}

async fn search_unified_sources(
    ctx: &SearchHandlerState,
    user_context: &UserContext,
    caller: SearchCaller,
    draws_api_key_allowance: bool,
    include_crm: bool,
    query_params: SearchPaginationParams,
    req: UnifiedSearchRequest,
) -> Result<UnifiedSearchPage, SearchError> {
    let user_id = user_context.user_id.clone();

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }
    let user_id = MacroUserId::parse_from_str(&user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_string()))?
        .lowercase();

    let search_on = req.search_on;
    let user_organization_id = user_context.organization_id;
    let collapse = req.collapse.unwrap_or(false);

    // Parse cursor from query params
    let cursor: Option<SearchCursor> = query_params
        .cursor
        .as_ref()
        .and_then(|c| SearchCursor::decode(c));

    if let Some(cursor) = cursor.as_ref()
        && cursor.is_exhausted()
    {
        return Err(SearchError::InvalidCursor);
    }

    let page_size = query_params.page_size.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    let query = trimmed_query(&req.query)?.to_string();
    let terms: Vec<String> = vec![query];
    let match_type = req.match_type;
    let split_terms = split_search_terms(&terms);
    let split_count = split_terms.len();
    let search_terms = enforce_term_limits(drop_wordless_terms(split_terms, match_type))?;
    let requested_term_matching = req.term_matching;

    // Typed dates are read in the caller's zone, and a later page reads
    // relative ones against the first page's moment.
    let clock = QueryClock {
        now: cursor
            .as_ref()
            .and_then(|cursor| cursor.query_time_millis)
            .and_then(chrono::DateTime::from_timestamp_millis)
            .unwrap_or_else(chrono::Utc::now),
        zone: time_zone(req.time_zone.as_deref()).ok_or(SearchError::InvalidTimeZone)?,
    };

    // Property filters live at the top level of the request and only apply to
    // the OpenSearch documents index, so capture them before the conversion
    // (which drops them) and attach them to the document search args below.
    // Tags, by contrast, are indexed on every taggable source, each of which
    // applies the tag filter itself (see the per-source gating below).
    let property_filter_args = to_property_filter_args(&req.filters.property_filters);
    let tag_option_ids = req.filters.tag_option_ids.clone();
    let match_all_tags = req.filters.tag_filter_mode == item_filters::TagFilterMode::All;
    // A tag filter keeps only the tag-indexed sources; channels and CRM drop
    // out below (see should_include_channels), so response pages contain only
    // rows the filter was actually applied to.
    let tags_active = !tag_option_ids.is_empty();

    // CRM is opt-in: it only runs when the caller resolved a team receipt
    // (set only when `include_crm` is true and the user has a qualifying
    // membership). `crm_company_filters` scopes/selects within the team.
    let crm_company_filters = req.filters.crm_company_filters.clone();

    let calendar_event_scope = req.calendar_event_scope;
    let mut search_filters = SearchEntityFilters::from(req.filters);
    let (search_terms, email_query) = apply_email_operators(
        &mut search_filters,
        include_crm,
        search_terms,
        match_type,
        clock,
    );
    record_term_counts(
        &tracing::Span::current(),
        search_terms.len(),
        split_count - search_terms.len(),
    );
    tracing::Span::current().record(
        "search.email_operators",
        email_query.as_ref().map_or(0, |query| query.operators),
    );
    // CRM companies cannot meet an email operator either.
    let include_crm = include_crm && email_query.is_none();
    let requested_sessions = search_filters
        .agent_session_filters
        .ids
        .iter()
        .map(|id| {
            uuid::Uuid::parse_str(id).map_err(|_| SearchError::InvalidAgentSessionId(id.clone()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    reject_unsupported_email_filters(&search_filters.email_filters)?;

    // The request's own checks (query, paging, cursor, terms, sessions, email
    // filters) have passed, so a malformed request fails at once instead of
    // waiting behind the caller's other searches. Ids a source parses only
    // when it runs (channel and CRM company ids) are checked in its turn, as
    // they were before lanes: a caller the source doesn't apply to never
    // fails on them.
    if draws_api_key_allowance {
        draw_search_allowance(ctx, &user_id).await?;
    }
    let _turn = take_search_turn(&ctx.search_lanes, caller).await?;

    // CRM is opt-in: only when the caller asks for it does this resolve a
    // team membership and mint a capability receipt. No membership → empty
    // CRM slice, not a failed search. See `resolve_crm_team_receipt`. It is
    // read after the caller's turn, so the membership is current when the
    // search runs however long the turn took.
    let crm_access = crm_company::resolve_crm_team_receipt(ctx, user_context, include_crm).await?;
    let should_include_crm = crm_access.is_some() && !tags_active;
    let agent_sessions = ctx
        .agent_session_search()
        .scope(
            &user_id,
            &requested_sessions,
            &search_filters.agent_session_filters.owners,
            search_filters.should_include_agent_sessions,
            tags_active,
        )
        .await
        .map_err(|error| SearchError::InternalError(anyhow::anyhow!("{error}")))?;
    let channel_filters = search_filters.channel_filters;
    let email_filters = search_filters.email_filters;
    let chat_filters = search_filters.chat_filters;
    let doc_filters = search_filters.document_filters;
    let project_filters = search_filters.project_filters;
    let call_filters = search_filters.call_filters;
    let calendar_event_filters = ScopedCalendarEventFilters {
        filters: search_filters.calendar_event_filters,
        scope: calendar_event_scope,
    };

    let should_include_documents = search_filters.should_include_documents;
    // A tag filter drops channels (and CRM, below) because they aren't
    // tag-indexed. Every tag-indexed source — documents, chats, projects,
    // emails, call records, calendar events — stays included and applies the
    // filter itself.
    let should_include_channels = search_filters.should_include_channels && !tags_active;
    // Channel names are searched in Postgres below; only a content search
    // needs the viewer's channel ids for the OpenSearch messages index.
    let should_search_channel_messages =
        should_include_channels && !matches!(search_on, SearchOn::Name);
    let should_include_chats = search_filters.should_include_chats;
    let should_include_projects = search_filters.should_include_projects;
    let should_include_emails = search_filters.should_include_emails;
    let should_include_call_records = search_filters.should_include_call_records;
    let should_include_calendar_events = calendar_events_searchable(
        search_filters.should_include_calendar_events,
        ctx.calendar_search_enabled,
    );
    let email_terms = search_terms.clone();

    // Term matching only applies to document content, so a search that leaves
    // it out never reads the rollout.
    let searches_document_content =
        should_include_documents && !matches!(search_on, SearchOn::Name);
    let requested_term_matching = if searches_document_content {
        requested_term_matching
    } else {
        TermMatching::All
    };

    let first_page_term_matching = cursor
        .as_ref()
        .and_then(|cursor| cursor.document_term_matching);
    tracing::Span::current().record(
        "search.term_matching_from_cursor",
        first_page_term_matching.is_some(),
    );

    // Await all tasks in parallel
    let (filter_responses, document_term_matching) = tokio::join!(
        async {
            tokio::try_join!(
                doc_filters.filter_to_search_args(
                    ctx,
                    user_id.as_ref(),
                    user_organization_id,
                    should_include_documents,
                ),
                channel_filters.filter_to_search_args(
                    ctx,
                    user_id.as_ref(),
                    user_organization_id,
                    should_search_channel_messages,
                ),
                chat_filters.filter_to_search_args(
                    ctx,
                    user_id.as_ref(),
                    user_organization_id,
                    should_include_chats,
                ),
                email_search(ctx, &user_id, &email_filters, should_include_emails),
                project_filters.filter_to_search_args(
                    ctx,
                    user_id.as_ref(),
                    user_organization_id,
                    should_include_projects
                ),
                call_filters.filter_to_search_args(
                    ctx,
                    user_id.as_ref(),
                    user_organization_id,
                    should_include_call_records,
                ),
                calendar_event_filters.filter_to_search_args(
                    ctx,
                    user_id.as_ref(),
                    user_organization_id,
                    should_include_calendar_events,
                )
            )
        },
        resolve_document_term_matching(
            ctx.term_matching_rollout.as_ref(),
            &user_context.user_id,
            requested_term_matching,
            search_terms.len(),
            first_page_term_matching,
        ),
    );
    tracing::Span::current().record(
        "search.term_matching",
        tracing::field::debug(document_term_matching),
    );
    let (
        mut filter_document_response,
        mut filter_channel_response,
        mut filter_chat_response,
        email,
        mut filter_project_response,
        mut filter_call_record_response,
        mut filter_calendar_event_response,
    ) = filter_responses?;

    // Set terms on each index's search args.
    //
    // Every content index gets whitespace-split terms. Emails match each
    // term independently across many fields ANDed inside OpenSearch;
    // channel messages are single-doc-per-message so each token must
    // appear in the same message via bool.must. Documents, chats, and
    // call records are join-shape, where each term becomes a separate
    // has_child clause ANDed via bool.must. Projects and calendar events are
    // flat and match terms against their name/title only.
    filter_document_response.terms = search_terms.clone();
    filter_document_response.property_filters = property_filter_args;
    filter_document_response.tag_option_ids = tag_option_ids.clone();
    filter_document_response.match_all_tags = match_all_tags;
    filter_document_response.term_matching = document_term_matching;
    filter_channel_response.terms = search_terms.clone();
    filter_chat_response.terms = search_terms.clone();
    filter_chat_response.tag_option_ids = tag_option_ids.clone();
    filter_chat_response.match_all_tags = match_all_tags;
    let email_searchable = email.is_some();
    let (mut filter_email_response, email_hit_states) = match email {
        Some(EmailSearch {
            args,
            hit_states,
            shared_capped,
            project_capped,
        }) => {
            tracing::Span::current().record("search.email_shared_capped", shared_capped);
            tracing::Span::current().record("search.email_project_capped", project_capped);
            (args, hit_states)
        }
        None => Default::default(),
    };
    filter_email_response.terms = email_terms.clone();
    filter_email_response.tag_option_ids = tag_option_ids.clone();
    filter_email_response.match_all_tags = match_all_tags;
    filter_call_record_response.terms = search_terms.clone();
    filter_call_record_response.tag_option_ids = tag_option_ids.clone();
    filter_call_record_response.match_all_tags = match_all_tags;
    filter_project_response.terms = search_terms.clone();
    filter_project_response.tag_option_ids = tag_option_ids.clone();
    filter_project_response.match_all_tags = match_all_tags;
    filter_calendar_event_response.terms = search_terms.clone();
    filter_calendar_event_response.tag_option_ids = tag_option_ids;
    filter_calendar_event_response.match_all_tags = match_all_tags;

    // Clone terms for use in name searches
    let name_search_term = terms[0].clone();

    // Extract individual cursors from the combined cursor (SearchCursorOption)
    // Clone for use in async blocks and for cursor regeneration
    let chat_cursor = cursor
        .as_ref()
        .map(|c| c.chat_name_cursor.clone())
        .unwrap_or_default();

    let content_cursor = cursor
        .as_ref()
        .map(|c| c.content_cursor.clone())
        .unwrap_or_default();

    let crm_cursor = cursor
        .as_ref()
        .map(|c| c.crm_company_cursor.clone())
        .unwrap_or_default();

    let channel_name_cursor = cursor
        .as_ref()
        .map(|c| c.channel_name_cursor.clone())
        .unwrap_or_default();

    // Clone cursors for passing to search functions (originals needed for cursor regeneration)
    let chat_cursor_for_search = chat_cursor.clone();
    let content_cursor_for_search = content_cursor.clone();
    let crm_cursor_for_search = crm_cursor.clone();
    let channel_name_cursor_for_search = channel_name_cursor.clone();

    let mut unified_search_args = UnifiedSearchArgs {
        agent_session_search_args: AgentSessionSearchArgs {
            terms: search_terms.clone(),
            session_ids: agent_sessions
                .iter()
                .map(|session| session.id.to_string())
                .collect(),
            mode: match search_on {
                SearchOn::Name => AgentSessionSearchMode::Name,
                SearchOn::Content => AgentSessionSearchMode::Content,
                SearchOn::NameContent => AgentSessionSearchMode::NameContent,
            },
        },
        user_id: user_id.as_ref().to_string(),
        page: 0, // With cursor-based pagination, we always start from "page 0" relative to cursor
        page_size,
        cursor: content_cursor_for_search,
        match_type: match_type.to_string(),
        collapse,
        search_indices: {
            let mut indices = std::collections::HashSet::new();
            if !agent_sessions.is_empty() {
                indices.insert(models_opensearch::OpenSearchEntityType::AgentSessions);
            }
            if should_include_documents
                && !(filter_document_response.ids_only
                    && filter_document_response.document_ids.is_empty())
            {
                indices.insert(models_opensearch::OpenSearchEntityType::Documents);
            }
            if should_include_chats
                && !(filter_chat_response.ids_only && filter_chat_response.chat_ids.is_empty())
            {
                indices.insert(models_opensearch::OpenSearchEntityType::Chats);
            }
            if email_searchable {
                indices.insert(models_opensearch::OpenSearchEntityType::Emails);
            }
            if should_search_channel_messages && !filter_channel_response.channel_ids.is_empty() {
                indices.insert(models_opensearch::OpenSearchEntityType::Channels);
            }
            if should_include_call_records && !filter_call_record_response.call_ids.is_empty() {
                indices.insert(models_opensearch::OpenSearchEntityType::CallRecords);
            }
            if should_include_projects
                && !(filter_project_response.ids_only
                    && filter_project_response.project_ids.is_empty())
            {
                indices.insert(models_opensearch::OpenSearchEntityType::Projects);
            }
            // An event set narrowed to nothing would be rejected by the query
            // builder rather than matching everything, so drop the index.
            if should_include_calendar_events
                && !(filter_calendar_event_response.ids_only
                    && filter_calendar_event_response.calendar_event_ids.is_empty())
            {
                indices.insert(models_opensearch::OpenSearchEntityType::CalendarEvents);
            }
            indices
        },
        document_search_args: filter_document_response.clone(),
        email_search_args: filter_email_response.clone(),
        channel_message_search_args: filter_channel_response,
        chat_search_args: filter_chat_response.clone(),
        call_record_search_args: filter_call_record_response.clone(),
        project_search_args: filter_project_response,
        calendar_event_search_args: filter_calendar_event_response,
    };

    // Documents, email subjects, project names, call names, and
    // calendar event titles are name-searched in OpenSearch. In Name
    // mode keep only those indices: chats and channels name-search in
    // Postgres below. Documents match `document_name`, emails their
    // subject, projects their `name`, calls their `name`, calendar
    // events their `title`. Projects and calendar events have no
    // content, so a content-only search drops them.
    match search_on {
        SearchOn::Name => {
            unified_search_args.document_search_args.mode = DocumentSearchMode::Name;
            unified_search_args.call_record_search_args.mode = CallRecordSearchMode::Name;
            unified_search_args.email_search_args.subject_only = true;
            unified_search_args.search_indices.retain(|i| {
                *i == models_opensearch::OpenSearchEntityType::Documents
                    || *i == models_opensearch::OpenSearchEntityType::AgentSessions
                    || *i == models_opensearch::OpenSearchEntityType::Emails
                    || *i == models_opensearch::OpenSearchEntityType::Projects
                    || *i == models_opensearch::OpenSearchEntityType::CallRecords
                    || *i == models_opensearch::OpenSearchEntityType::CalendarEvents
            });
        }
        SearchOn::NameContent => {
            unified_search_args.document_search_args.mode = DocumentSearchMode::NameContent;
            unified_search_args.call_record_search_args.mode = CallRecordSearchMode::NameContent;
        }
        SearchOn::Content => {
            unified_search_args.document_search_args.mode = DocumentSearchMode::Content;
            unified_search_args
                .search_indices
                .remove(&models_opensearch::OpenSearchEntityType::Projects);
            unified_search_args
                .search_indices
                .remove(&models_opensearch::OpenSearchEntityType::CalendarEvents);
        }
    }
    let searches_names = matches!(search_on, SearchOn::Name | SearchOn::NameContent);
    tracing::Span::current().record(
        "search.entity_types",
        searched_entity_types(
            &unified_search_args.search_indices,
            &[
                ("chats", should_include_chats && searches_names),
                ("channels", should_include_channels && searches_names),
                ("crm_companies", should_include_crm && searches_names),
            ],
        ),
    );

    // Call search functions in parallel for included entity types
    // search_names handles Done cursors internally by returning early
    let (chat_results, channel_results, content_results, crm_results) = tokio::join!(
        async {
            if should_include_chats {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_chat::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_chat::FilterChatResponse {
                                ids_only: filter_chat_response.ids_only,
                                chat_ids: filter_chat_response.chat_ids,
                            },
                            name_search_term.clone(),
                            &filter_chat_response.tag_option_ids,
                            filter_chat_response.match_all_tags,
                            page_size,
                            chat_cursor_for_search,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], SearchCursorOption::Done)),
                }
            } else {
                Ok((vec![], SearchCursorOption::Done))
            }
        },
        async {
            // Channel names depend on the viewer (a DM is named after the
            // other participant), so they are matched in Postgres rather than
            // the message-level channels index.
            match search_on {
                SearchOn::Name | SearchOn::NameContent if should_include_channels => {
                    simple_channel::search_names(
                        &ctx.db,
                        &user_id,
                        &channel_filters,
                        name_search_term.clone(),
                        match_type == MatchType::Exact,
                        page_size,
                        channel_name_cursor_for_search,
                    )
                    .await
                }
                _ => Ok((vec![], SearchCursorOption::Done)),
            }
        },
        async {
            let args = unified_search_args;
            if args.search_indices.is_empty() || args.cursor.is_done() {
                Ok(ContentHits {
                    hits: vec![],
                    cursor: SearchCursorOption::Done,
                    email_states_checked: false,
                })
            } else {
                search_content(ctx, &user_id, args, &email_hit_states).await
            }
        },
        async {
            // CRM companies are name/domain only — no content index — so
            // they only participate under Name / NameContent.
            match (should_include_crm, crm_access.as_ref(), search_on) {
                (true, Some(access), SearchOn::Name | SearchOn::NameContent) => {
                    crm_company::search_company_names(
                        ctx,
                        access,
                        &crm_company_filters,
                        name_search_term.clone(),
                        page_size,
                        crm_cursor_for_search,
                    )
                    .await
                }
                _ => Ok((vec![], SearchCursorOption::Done)),
            }
        },
    );

    // Extract results and next cursors
    let (chat_hits, chat_next_cursor) = chat_results?;
    let (channel_hits, channel_next_cursor) = channel_results?;
    let ContentHits {
        hits: content_hits,
        cursor: content_next_cursor,
        email_states_checked,
    } = content_results?;
    let (crm_hits, crm_next_cursor) = crm_results?;

    // Track original counts before combining
    let chat_name_count = chat_hits.len();
    let channel_name_count = channel_hits.len();
    // Content hits are chunk-level (many per document), so the page budget counts
    // distinct documents. Name/crm sub-searches return one row per entity, so
    // their hit count already equals their entity count.
    let content_count = distinct_entity_count(&content_hits);
    let crm_count = crm_hits.len();

    let final_tagged = {
        // Wrap results with source tags
        let mut combined: Vec<TaggedSearchHit> = Vec::new();
        combined.extend(chat_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::ChatName,
        }));
        combined.extend(channel_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::ChannelName,
        }));
        combined.extend(content_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::Content,
        }));
        combined.extend(crm_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::CrmCompany,
        }));

        // Sort: updated_at DESC (None to bottom), entity_id DESC as tiebreaker
        combined.sort_by(|a, b| match (&b.hit.updated_at, &a.hit.updated_at) {
            (Some(b_ts), Some(a_ts)) => b_ts
                .cmp(a_ts)
                .then_with(|| b.hit.entity_id.cmp(&a.hit.entity_id)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.hit.entity_id.cmp(&a.hit.entity_id),
        });

        // Take the first page_size distinct entities (keeping all of each
        // entity's hits), not the first page_size hits.
        let page_size_usize = page_size as usize;
        take_first_n_entities(combined, page_size_usize)
    };

    let next_cursor = {
        // Count included results by source
        let included_chat_names = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::ChatName)
            .count();
        let included_channel_names = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::ChannelName)
            .count();
        let included_content = distinct_entity_count(
            final_tagged
                .iter()
                .filter(|h| h.source == SearchSource::Content)
                .map(|h| &h.hit),
        );
        let included_crm = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::CrmCompany)
            .count();

        // Generate new cursors using helper function
        let new_chat_cursor = compute_next_cursor(
            &chat_next_cursor,
            included_chat_names,
            chat_name_count,
            find_last_of_source(&final_tagged, SearchSource::ChatName),
            &chat_cursor,
        );

        let new_channel_cursor = compute_next_cursor(
            &channel_next_cursor,
            included_channel_names,
            channel_name_count,
            find_last_of_source(&final_tagged, SearchSource::ChannelName),
            &channel_name_cursor,
        );

        let new_content_cursor = next_content_cursor(
            email_states_checked,
            &content_next_cursor,
            included_content,
            content_count,
            find_last_of_source(&final_tagged, SearchSource::Content),
            &content_cursor,
        );

        let new_crm_cursor = compute_next_cursor(
            &crm_next_cursor,
            included_crm,
            crm_count,
            find_last_of_source(&final_tagged, SearchSource::CrmCompany),
            &crm_cursor,
        );

        // Build next cursor if any source has more results
        let has_more = new_chat_cursor.has_more()
            || new_channel_cursor.has_more()
            || new_content_cursor.has_more()
            || new_crm_cursor.has_more();

        if has_more {
            let cursor = SearchCursor {
                chat_name_cursor: new_chat_cursor,
                content_cursor: new_content_cursor,
                // Projects ride the OpenSearch content cursor; the field
                // stays only so older cursors still decode.
                project_name_cursor: SearchCursorOption::Done,
                crm_company_cursor: new_crm_cursor,
                channel_name_cursor: new_channel_cursor,
                document_term_matching: term_matching_for_cursor(
                    requested_term_matching,
                    search_terms.len(),
                    document_term_matching,
                ),
                query_time_millis: email_query
                    .as_ref()
                    .filter(|query| query.reads_now)
                    .map(|_| clock.now.timestamp_millis()),
            };
            cursor.encode()
        } else {
            None
        }
    };

    // Extract final SearchHits from tagged results
    let final_results: Vec<SearchHit> = final_tagged.into_iter().map(|t| t.hit).collect();

    Ok(UnifiedSearchPage {
        hits: final_results,
        next_cursor,
        crm_access,
        query_filters: email_query.as_ref().map(reported_filters),
    })
}

/// Perform a search through all items.
/// This is a simple search where we do not group your results by entity id.
#[utoipa::path(
    post,
    path = "/search/simple",
    operation_id = "simple_unified_search",
    params(
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
            ("cursor" = Option<String>, Query, description = "Base64 encoded cursor for pagination."),
    ),
    responses(
            (status = 200, body=SimpleSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 429, body=ErrorResponse, description = "The caller's other searches kept every slot of its lane busy for 20 seconds, or the account's user API keys used their shared search allowance (200 at once, then one a second); retry after `Retry-After` seconds."),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn handler(
    State(ctx): State<SearchHandlerState>,
    authorization: MacroAuthorizationExtractor<SearchAuthorizationService, UserOrInternal>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<UnifiedSearchRequest>,
) -> Result<Json<SimpleSearchResponse>, SearchError> {
    let user = &authorization.authorization.user;

    tracing::info!(
        user_id = user.user_context.user_id,
        search_on = ?req.search_on,
        "simple_unified_search"
    );

    // CRM opt-in is wired through the unified `/search` endpoint only.
    let results = perform_unified_search(&ctx, user, false, query_params, req).await?;

    let results = results.hits.into_iter().map(|a| a.into()).collect();

    // Note: SimpleSearchResponse doesn't have a next_cursor field
    // The cursor is returned by the unified search endpoint (/search)
    Ok(Json(SimpleSearchResponse { results }))
}

#[cfg(test)]
mod test;
