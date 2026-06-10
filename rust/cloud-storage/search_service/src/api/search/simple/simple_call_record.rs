use std::collections::HashSet;

use item_filters::{CallFilters, CallStatus};

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
    let status_filter = status_filter_values(filters);
    let accessible = macro_db_client::call_record::get::get_accessible_call_ids(
        &ctx.db,
        user_id,
        &status_filter,
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

fn status_filter_values(filters: &CallFilters) -> Vec<String> {
    if let Some(status) = filters.status {
        return vec![status_value(status).to_string()];
    }

    match filters.attended {
        Some(true) => vec!["ATTENDED".to_string()],
        Some(false) => vec!["MISSED".to_string(), "UNATTENDED".to_string()],
        None => Vec::new(),
    }
}

fn status_value(status: CallStatus) -> &'static str {
    match status {
        CallStatus::Attended => "ATTENDED",
        CallStatus::Missed => "MISSED",
        CallStatus::Unattended => "UNATTENDED",
    }
}
