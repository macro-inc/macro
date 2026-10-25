//! Request to join a channel-shared calendar event notification projection.

use async_graphql::{ID, SimpleObject};
use model_notifications::CalendarEventJoinRequestMetadata;

/// Metadata for a request to be added as a guest of a shared calendar event.
#[derive(SimpleObject)]
pub struct GraphqlCalendarEventJoinRequestMetadata {
    /// Join request identifier.
    request_id: ID,
    /// The shared calendar event identifier.
    event_id: ID,
    /// Event display title when the request was made.
    title: String,
}

impl From<CalendarEventJoinRequestMetadata> for GraphqlCalendarEventJoinRequestMetadata {
    fn from(value: CalendarEventJoinRequestMetadata) -> Self {
        Self {
            request_id: ID(value.request_id.to_string()),
            event_id: ID(value.event_id.to_string()),
            title: value.title,
        }
    }
}
