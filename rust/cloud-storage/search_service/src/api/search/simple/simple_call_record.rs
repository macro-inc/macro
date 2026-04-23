use item_filters::CallFilters;

use crate::api::context::SearchHandlerState;
use crate::api::search::simple::SearchError;

#[derive(Debug)]
pub(in crate::api::search) struct FilterCallResponse {
    /// The set of call record ids the user can access. Used as an `ids_only`
    /// scope against the OpenSearch `call_records` index — `entity_id` on each
    /// indexed doc is the call id.
    pub call_ids: Vec<String>,
    /// Optional additional narrowing by channel.
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

    let call_ids = accessible.into_iter().map(|id| id.to_string()).collect();

    Ok(FilterCallResponse {
        call_ids,
        channel_ids: filters.channel_ids.clone(),
    })
}
