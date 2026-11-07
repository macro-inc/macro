use crate::api::search::simple::SearchError;
use item_filters::CalendarEventFilters;
use models_search::calendar_event::CalendarEventSearchScope;
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
/// Access is resolved here rather than taken from the request. In the own
/// scope an event is visible when the caller owns its projection or the
/// event's source link is one of their inboxes (own or delegated).
/// `fetch_inboxes_for_macro_id` is the authority for that set, so a caller
/// cannot widen their own scope by passing link ids. The shared scope is the
/// explicit set of events shared with the caller's channels, so it always
/// searches by id.
///
/// `ids_only` is otherwise set only when the caller named specific event ids.
/// Without them the query stays scoped by owner/link, because an empty id list
/// under `ids_only` would be rejected rather than matching everything.
#[tracing::instrument(
    name = "search.calendar_event_access",
    skip(ctx, user_id, filters),
    fields(
        named_event_count = filters.calendar_event_ids.len(),
        calendar_event_count,
        link_count
    ),
    err
)]
pub(in crate::api::search) async fn filter_calendar_events(
    ctx: &SearchHandlerState,
    user_id: &str,
    filters: &CalendarEventFilters,
    scope: CalendarEventSearchScope,
) -> Result<FilterCalendarEventResponse, SearchError> {
    // Keep only well-formed ids: the index stores `entity_id` as a keyword, so
    // a malformed value would silently match nothing rather than error.
    let calendar_event_ids: Vec<String> = filters
        .calendar_event_ids
        .iter()
        .filter(|id| Uuid::parse_str(id).is_ok())
        .cloned()
        .collect();

    let response = match scope {
        CalendarEventSearchScope::Own => {
            let inboxes = email_db_client::links::get::fetch_inboxes_for_macro_id(&ctx.db, user_id)
                .await
                .map_err(SearchError::InternalError)?;
            FilterCalendarEventResponse {
                calendar_event_ids,
                link_ids: inboxes.iter().map(|l| l.id.to_string()).collect(),
                ids_only: !filters.calendar_event_ids.is_empty(),
            }
        }
        CalendarEventSearchScope::SharedWithYou => {
            let named: Vec<Uuid> = calendar_event_ids
                .iter()
                .filter_map(|id| Uuid::parse_str(id).ok())
                .collect();
            let shared = macro_db_client::calendar_event::get_events_for_search::get_channel_shared_calendar_event_ids(
                &ctx.db, user_id,
            )
            .await
            .map_err(SearchError::InternalError)?;
            FilterCalendarEventResponse {
                // Named ids narrow within the shared set; they never add to it.
                calendar_event_ids: shared
                    .into_iter()
                    .filter(|id| filters.calendar_event_ids.is_empty() || named.contains(id))
                    .map(|id| id.to_string())
                    .collect(),
                link_ids: Vec::new(),
                ids_only: true,
            }
        }
    };
    let span = tracing::Span::current();
    span.record("calendar_event_count", response.calendar_event_ids.len());
    span.record("link_count", response.link_ids.len());
    Ok(response)
}
