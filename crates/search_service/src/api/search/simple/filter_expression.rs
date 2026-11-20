//! Validate the supported Soup expression input before searching any source.

use graphql_soup_filter_input::materialize_graphql_filter;
use opensearch_client::search::documents::filter_expression::{
    CompiledFilterExpression, compile_filter_expression,
};
use serde_json::Value;

use super::SearchError;

pub(super) fn compile(
    value: Option<Value>,
) -> Result<Option<CompiledFilterExpression>, SearchError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let object = value
        .as_object()
        .ok_or(SearchError::InvalidFilterExpression)?;
    // Other Soup scopes require different indexes or server-side resolution.
    // Reject them before materialization, including obsolete fields it discards.
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "documentFilter" | "propertiesFilter"))
    {
        return Err(SearchError::InvalidFilterExpression);
    }
    let filter =
        materialize_graphql_filter(value).map_err(|_| SearchError::InvalidFilterExpression)?;
    compile_filter_expression(
        filter.document_filter.as_deref(),
        filter.properties_filter.as_deref(),
    )
    .map(Some)
    .map_err(|_| SearchError::InvalidFilterExpression)
}

/// Only document sources can honor this expression subset.
pub(super) fn restrict_sources(filters: &mut models_search::unified::SearchEntityFilters) {
    filters.should_include_agent_sessions = false;
    filters.should_include_chats = false;
    filters.should_include_emails = false;
    filters.should_include_channels = false;
    filters.should_include_projects = false;
    filters.should_include_call_records = false;
    filters.should_include_calendar_events = false;
}
#[cfg(test)]
mod test;
