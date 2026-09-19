use crate::api::search::simple::SearchError;
use item_filters::CalendarEventFilters;
use uuid::Uuid;

use crate::api::context::SearchHandlerState;

#[derive(Debug)]
pub(in crate::api::search) struct FilterCalendarEventResponse {
    pub calendar_event_ids: Vec<String>,
    /// Every inbox link the caller can read, resolved server-side.
    pub link_ids: Vec<String>,
    pub ids_only: bool,
}

/// Resolve what the caller may search over.
///
/// Access is resolved here rather than taken from the request: an event is
/// visible when the caller owns its projection or the event's source link is
/// one of their inboxes (own or delegated). `fetch_inboxes_for_macro_id` is
/// the authority for that set, so a caller cannot widen their own scope by
/// passing link ids.
///
/// `ids_only` is set only when the caller named specific event ids. Otherwise
/// the query stays scoped by owner/link, because an empty id list under
/// `ids_only` would be rejected rather than matching everything.
#[tracing::instrument(skip(ctx, filters), err)]
pub(in crate::api::search) async fn filter_calendar_events(
    ctx: &SearchHandlerState,
    user_id: &str,
    filters: &CalendarEventFilters,
) -> Result<FilterCalendarEventResponse, SearchError> {
    let inboxes = email_db_client::links::get::fetch_inboxes_for_macro_id(&ctx.db, user_id)
        .await
        .map_err(SearchError::InternalError)?;
    let link_ids: Vec<String> = inboxes.iter().map(|l| l.id.to_string()).collect();

    // Keep only well-formed ids: the index stores `entity_id` as a keyword, so
    // a malformed value would silently match nothing rather than error.
    let calendar_event_ids: Vec<String> = filters
        .calendar_event_ids
        .iter()
        .filter(|id| Uuid::parse_str(id).is_ok())
        .cloned()
        .collect();

    let ids_only = !filters.calendar_event_ids.is_empty();

    Ok(FilterCalendarEventResponse {
        calendar_event_ids,
        link_ids,
        ids_only,
    })
}
