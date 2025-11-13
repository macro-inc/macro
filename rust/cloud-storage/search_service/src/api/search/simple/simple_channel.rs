use crate::api::search::{SearchPaginationParams, simple::SearchError};
use std::collections::HashSet;

use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::channel::{ChannelSearchRequest, SimpleChannelSearchResponse};
use opensearch_client::search::channels::ChannelMessageSearchArgs;

use crate::api::ApiContext;

/// Perform a search through your channels
/// This is a simple search where we do not group your results by channel id.
#[utoipa::path(
        post,
        path = "/search/simple/channel",
        operation_id = "simple_channel_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=SimpleChannelSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, query_params), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<ChannelSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("simple_channel_search");

    let results = search_channels(
        &ctx,
        user_context.user_id.as_str(),
        user_context.organization_id,
        &query_params,
        req,
    )
    .await?;

    Ok((
        StatusCode::OK,
        Json(SimpleChannelSearchResponse {
            results: results.into_iter().map(|a| a.into()).collect(),
        }),
    )
        .into_response())
}

pub(in crate::api::search) async fn search_channels(
    ctx: &ApiContext,
    user_id: &str,
    organization_id: Option<i32>,
    query_params: &SearchPaginationParams,
    req: ChannelSearchRequest,
) -> Result<Vec<opensearch_client::search::channels::ChannelMessageSearchResponse>, SearchError> {
    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    let page = query_params.page.unwrap_or(0);

    let page_size = if let Some(page_size) = query_params.page_size {
        if !(0..=100).contains(&page_size) {
            return Err(SearchError::InvalidPageSize);
        }
        page_size
    } else {
        10
    };

    let terms: Vec<String> = if let Some(terms) = req.terms {
        terms
            .into_iter()
            .filter_map(|t| if t.len() < 3 { None } else { Some(t) })
            .collect()
    } else if let Some(query) = req.query {
        if query.len() < 3 {
            return Err(SearchError::InvalidQuerySize);
        }

        vec![query]
    } else {
        return Err(SearchError::NoQueryOrTermsProvided);
    };

    // Get all channel ids for the user
    let channel_ids = ctx
        .comms_service_client
        .get_user_channel_ids(user_id, organization_id)
        .await
        .map_err(|e| SearchError::InternalError(e.into()))?;

    // If the user has no channels, return an empty response
    if channel_ids.is_empty() {
        return Ok(vec![]);
    }

    let filters = req.filters.unwrap_or_default();

    // filter through specific channel ids if provided
    let channel_ids = if !filters.channel_ids.is_empty() {
        let available_ids: HashSet<String> = filters.channel_ids.into_iter().collect();

        channel_ids
            .into_iter()
            .filter(|id| available_ids.contains(&id.to_string()))
            .collect()
    } else {
        channel_ids
    };

    // filter through org_id if provided
    let channel_ids = if let Some(org_id) = filters.org_id {
        macro_db_client::items::filter::filter_channels_by_org_id(&ctx.db, &channel_ids, org_id)
            .await?
    } else {
        channel_ids
    };

    let results = ctx
        .opensearch_client
        .search_channel_messages(ChannelMessageSearchArgs {
            terms,
            user_id: user_id.to_string(),
            channel_ids: channel_ids.iter().map(|c| c.to_string()).collect(),
            thread_ids: filters.thread_ids,
            mentions: filters.mentions,
            page,
            page_size,
            match_type: req.match_type.to_string(),
            sender_ids: filters.sender_ids,
            search_on: req.search_on.into(),
            collapse: req.collapse.unwrap_or(false),
            ids_only: true, // For channel message search, we always want to search over the channel ids only
        })
        .await
        .map_err(SearchError::Search)?;

    Ok(results)
}
