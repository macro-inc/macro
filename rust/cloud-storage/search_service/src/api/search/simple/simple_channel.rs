use crate::api::search::simple::SearchError;
use item_filters::ChannelFilters;
use std::collections::HashSet;

use crate::api::ApiContext;

pub(in crate::api::search) struct FilterChannelResponse {
    pub channel_ids: Vec<sqlx::types::Uuid>,
}

pub(in crate::api::search) async fn filter_channels(
    ctx: &ApiContext,
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
