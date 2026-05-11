use std::collections::HashSet;

use item_filters::CallFilters;

use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;

#[derive(Debug)]
pub(in crate::api::search) struct FilterCallResponse {
    pub call_ids: Vec<String>,
    pub channel_ids: Vec<String>,
}

#[tracing::instrument(skip(ctx, filters), err)]
pub(in crate::api::search) async fn filter_calls(
    ctx: &SearchHandlerState,
    user_id: &str,
    filters: &CallFilters,
) -> Result<FilterCallResponse, SearchError> {
    let accessible = macro_db_client::call_record::get::get_accessible_call_ids(
        &ctx.db,
        user_id,
        filters.attended,
    )
    .await
    .map_err(SearchError::InternalError)?;

    let accessible_ids: Vec<String> = accessible.into_iter().map(|id| id.to_string()).collect();

    let call_ids = if filters.call_ids.is_empty() {
        accessible_ids
    } else {
        let requested: HashSet<&str> = filters.call_ids.iter().map(String::as_str).collect();
        accessible_ids
            .into_iter()
            .filter(|id| requested.contains(id.as_str()))
            .collect()
    };

    Ok(FilterCallResponse {
        call_ids,
        channel_ids: filters.channel_ids.clone(),
    })
}
