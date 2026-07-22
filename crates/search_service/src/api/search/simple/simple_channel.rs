use crate::api::search::simple::SearchError;
use item_filters::ChannelFilters;
use macro_user_id::user_id::MacroUserId;
use opensearch_client::search::model::{Highlight, SearchHit};
use std::collections::HashSet;

use crate::api::context::SearchHandlerState;

#[derive(Debug, Clone)]
pub(in crate::api::search) struct FilterChannelResponse {
    pub channel_ids: Vec<sqlx::types::Uuid>,
}

/// Performs the name search over channel names.
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(db), err)]
pub(in crate::api::search) async fn search_names<'a>(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &MacroUserId<macro_user_id::lowercased::Lowercase<'a>>,
    filter_channel_response: &FilterChannelResponse,
    term: String,
    exact_match: bool,
    limit: u32,
    cursor: models_search_cursor::SearchCursorOption,
) -> Result<(Vec<SearchHit>, models_search_cursor::SearchCursorOption), SearchError> {
    let inner_cursor = match cursor {
        models_search_cursor::SearchCursorOption::Done => {
            return Ok((vec![], models_search_cursor::SearchCursorOption::Done));
        }
        models_search_cursor::SearchCursorOption::NotDone(c) => c,
    };

    name_search::search_channel_names(
        db,
        user_id,
        &filter_channel_response.channel_ids,
        term,
        exact_match,
        limit,
        inner_cursor,
    )
    .await
    .map_err(SearchError::NameSearch)
    .map(|response| {
        let hits = response
            .items
            .into_iter()
            .map(|result| SearchHit {
                entity_id: result.entity_id,
                entity_type: result.entity_type,
                score: None,
                highlight: Highlight {
                    name: Some(result.name),
                    ..Default::default()
                },
                goto: None,
                updated_at: Some(result.updated_at),
            })
            .collect();
        (hits, response.cursor)
    })
}

#[tracing::instrument(skip(ctx, filters), err)]
pub(in crate::api::search) async fn filter_channels(
    ctx: &SearchHandlerState,
    user_id: &str,
    organization_id: Option<i32>,
    filters: &ChannelFilters,
) -> Result<FilterChannelResponse, SearchError> {
    // Get all channel ids for the user directly from DB
    let channel_ids = comms_db_client::channels::get_channels::get_user_channel_ids(
        &ctx.db,
        user_id,
        organization_id.map(|id| id as i64),
    )
    .await
    .map_err(|e| SearchError::InternalError(e.into()))?;

    // If the user has no channels, return an empty response
    if channel_ids.is_empty() {
        return Ok(FilterChannelResponse {
            channel_ids: vec![],
        });
    }

    // filter through specific channel ids if provided
    let channel_ids = if !filters.channel_ids.is_empty() {
        let available_ids: HashSet<String> = filters
            .channel_ids
            .iter()
            .map(|id| id.to_string())
            .collect();

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

    Ok(FilterChannelResponse { channel_ids })
}
