use crate::api::search::simple::SearchError;
use crate::api::search::terms::split_search_terms;
use chrono::{DateTime, Utc};
use indexmap::IndexMap;
use std::collections::HashMap;

use crate::api::context::SearchHandlerState;
use crate::api::search::SearchPaginationParams;
use axum::{
    Extension, Router,
    extract::{self, State},
    response::Json,
    routing::post,
};
use macro_user_id::user_id::MacroUserId;
use model::comms::ChannelHistoryInfo;
use model::user::UserContext;
use models_search::MatchType;
use models_search::channel::{
    ChannelSearchRequest, ChannelSearchResponse, ChannelSearchResponseItem,
    ChannelSearchResponseItemWithMetadata, ChannelSearchResult, ChannelSortTimestamp,
};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use opensearch_client::search::channels::{ChannelSearchArgs, ChannelSortMode};
use opensearch_client::search::model::SearchGotoContent;
use sqlx::types::Uuid;

/// Enriches channel message search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_channels(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
    sort_timestamp: ChannelSortTimestamp,
) -> Result<Vec<ChannelSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::Channels)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }

    // Extract channel IDs from results
    let channel_ids: Vec<Uuid> = results.iter().map(|r| r.entity_id).collect();

    // Extract message IDs from results so we can flag any that have been deleted.
    let message_ids: Vec<Uuid> = results
        .iter()
        .filter_map(|r| match &r.goto {
            Some(SearchGotoContent::Channels(goto)) => Some(goto.channel_message_id),
            _ => None,
        })
        .collect();

    let (channel_histories, message_states) = tokio::try_join!(
        async {
            comms_db_client::activity::get_activity::get_channel_history_info(
                &ctx.db,
                user_id,
                &channel_ids,
            )
            .await
            .map_err(anyhow::Error::from)
        },
        async {
            comms_db_client::messages::get_deleted_ats::get_message_deletion_states(
                &ctx.db,
                &message_ids,
            )
            .await
        },
    )
    .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results =
        construct_search_result(results, channel_histories, message_states, sort_timestamp)
            .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    channel_histories: HashMap<Uuid, ChannelHistoryInfo>,
    message_states: HashMap<Uuid, Option<DateTime<Utc>>>,
    sort_timestamp: ChannelSortTimestamp,
) -> anyhow::Result<Vec<ChannelSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits> using IndexMap to preserve insertion order
    let entity_id_hit_map: IndexMap<sqlx::types::Uuid, Vec<ChannelSearchResult>> = search_results
        .into_iter()
        .filter_map(|hit| {
            let result = if let Some(SearchGotoContent::Channels(goto)) = hit.goto {
                // Drop content-match hits whose underlying message no longer exists in
                // the DB — those are stale OpenSearch entries (e.g. hard-deleted) that
                // shouldn't surface to users.
                let deleted_at = *message_states.get(&goto.channel_message_id)?;
                ChannelSearchResult {
                    highlight: hit.highlight.into(),
                    score: hit.score,
                    message_id: Some(goto.channel_message_id),
                    thread_id: goto.thread_id,
                    sender_id: Some(goto.sender_id),
                    created_at: Some(goto.created_at),
                    updated_at: Some(goto.updated_at),
                    deleted_at,
                }
            } else {
                // name match
                ChannelSearchResult {
                    highlight: hit.highlight.into(),
                    score: hit.score,
                    message_id: None,
                    thread_id: None,
                    sender_id: None,
                    created_at: None,
                    updated_at: None,
                    deleted_at: None,
                }
            };
            Some((hit.entity_id, result))
        })
        .fold(IndexMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results in the original search result order
    let result: Vec<ChannelSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, mut hits)| {
            match sort_timestamp {
                ChannelSortTimestamp::Message => {
                    hits.sort_by(|a, b| {
                        b.created_at
                            .cmp(&a.created_at)
                            .then_with(|| b.message_id.cmp(&a.message_id))
                    });
                }
                ChannelSortTimestamp::Thread => {}
            }

            if let Some(info) = channel_histories.get(&entity_id) {
                let info = info.clone();
                let metadata = models_search::channel::ChannelMetadata {
                    created_at: info.created_at,
                    updated_at: info.updated_at,
                    viewed_at: info.viewed_at,
                    interacted_at: info.interacted_at,
                };
                Some(ChannelSearchResponseItemWithMetadata {
                    metadata: Some(metadata),
                    extra: ChannelSearchResponseItem {
                        id: entity_id,
                        channel_id: entity_id,
                        owner_id: Some(info.user_id),
                        channel_type: info.channel_type,
                        channel_message_search_results: hits,
                    },
                })
            } else {
                None
            }
        })
        .collect();

    Ok(result)
}

pub fn router() -> Router<SearchHandlerState> {
    Router::new().route("/", post(handler))
}

/// Channel content search.
#[utoipa::path(
    post,
    path = "/search/channel",
    operation_id = "channel_search",
    params(
        ("page_size" = i64, Query, description = "Page size, defaults to 10."),
        ("cursor" = Option<String>, Query, description = "Base64-encoded cursor."),
    ),
    responses(
        (status = 200, body=ChannelSearchResponse),
        (status = 400, body=model::response::ErrorResponse),
        (status = 401, body=model::response::ErrorResponse),
        (status = 500, body=model::response::ErrorResponse),
    )
)]
pub async fn handler(
    State(ctx): State<SearchHandlerState>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<ChannelSearchRequest>,
) -> Result<Json<ChannelSearchResponse>, SearchError> {
    let user_id = user_context.user_id.clone();
    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }
    let user_id = MacroUserId::parse_from_str(&user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_string()))?
        .lowercase();

    let page_size = query_params.page_size.unwrap_or(10);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    let raw_terms = match (req.query, req.terms) {
        (Some(q), _) if !q.trim().is_empty() => vec![q.trim().to_string()],
        (_, Some(t)) if !t.is_empty() => t,
        _ => return Err(SearchError::NoQueryOrTermsProvided),
    };
    // An exact match treats the query as a single phrase (as if double-quoted)
    // so multi-word input matches the literal phrase. Other match types split on
    // whitespace and AND the resulting terms.
    let terms = if req.match_type == MatchType::Exact {
        raw_terms
    } else {
        split_search_terms(&raw_terms)
    };
    if terms.is_empty() {
        return Err(SearchError::NoQueryOrTermsProvided);
    }
    if terms.iter().any(|t| t.len() < 3) {
        return Err(SearchError::InvalidQuerySize);
    }

    let cursor = query_params
        .cursor
        .as_ref()
        .and_then(|c| SearchMethodCursor::decode(c));
    let cursor_option = cursor
        .map(|c| SearchCursorOption::NotDone(Some(c)))
        .unwrap_or_default();

    let filters = req.filters.unwrap_or_default();
    if filters.channel_ids.is_empty() {
        return Err(SearchError::NoChannelIds);
    }
    let sort_mode = match req.sort {
        ChannelSortTimestamp::Message => ChannelSortMode::Message,
        ChannelSortTimestamp::Thread => ChannelSortMode::Thread,
    };

    let args = ChannelSearchArgs {
        user_id: user_id.as_ref().to_string(),
        page_size,
        match_type: req.match_type.to_string(),
        cursor: cursor_option,
        terms,
        channel_ids: filters.channel_ids,
        thread_ids: filters.thread_ids,
        mentions: filters.mentions,
        sender_ids: filters.sender_ids,
        sort_mode,
    };

    let opensearch_client::search::channels::ChannelSearchResults {
        hits,
        next_cursor,
        total: total_count,
    } = ctx
        .opensearch_client
        .search_channel(args)
        .await
        .map_err(SearchError::Search)?;

    let results = enrich_channels(&ctx, user_id.as_ref(), hits, req.sort).await?;

    let next_cursor = match next_cursor {
        SearchCursorOption::NotDone(Some(c)) => c.encode(),
        _ => None,
    };

    Ok(Json(ChannelSearchResponse {
        results,
        next_cursor,
        total_count,
    }))
}

#[cfg(test)]
mod test;
