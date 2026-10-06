//! GraphQL inbound adapter for calendars: typed calendar, event, and
//! occurrence objects and the authenticated user's calendar read fields.
#![deny(missing_docs)]

mod inputs;
mod objects;
mod reads;
#[cfg(test)]
mod test_fixtures;
mod user_query;

pub use inputs::CalendarRangeInput;
pub use objects::{
    GraphqlAllDayEventTime, GraphqlCalendar, GraphqlCalendarAttendee,
    GraphqlCalendarAttendeeResponseStatus, GraphqlCalendarConferenceProvider, GraphqlCalendarEvent,
    GraphqlCalendarEventSource, GraphqlCalendarEventStatus, GraphqlCalendarEventTransparency,
    GraphqlCalendarEventType, GraphqlCalendarEventVisibility, GraphqlCalendarLinkWatermark,
    GraphqlCalendarOccurrence, GraphqlCalendarOccurrencePage, GraphqlCalendarReminderOverride,
    GraphqlCalendarReminders, GraphqlCalendarSyncStatus, GraphqlEventTime, GraphqlTimedEventTime,
};
pub use reads::CalendarGraphqlContext;
pub use user_query::GraphqlCalendarQuery;

use async_graphql::ErrorExtensions;
use rootcause::Report;

pub(crate) fn bad_input(message: impl Into<String>) -> async_graphql::Error {
    async_graphql::Error::new(message.into()).extend_with(|_, extensions| {
        extensions.set("code", "BAD_USER_INPUT");
    })
}

pub(crate) fn unavailable(error: Report, message: &'static str) -> async_graphql::Error {
    tracing::error!(error = ?error, "{message}");
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", "INTERNAL_SERVER_ERROR");
    })
}
