//! GraphQL inbound adapter for calendars: typed calendar, event, and
//! occurrence objects and the authenticated user's calendar read fields.
#![deny(missing_docs)]

mod inputs;
mod mutation;
mod objects;
mod reads;
#[cfg(test)]
mod test_fixtures;
mod user_query;
mod writes;

pub use inputs::{CalendarChangesInput, CalendarLinkWatermarkInput, CalendarRangeInput};
pub use mutation::{
    AllDayEventTimeInput, CalendarEventTimeInput, CalendarMutationRoot, CalendarOutOfOfficeInput,
    CalendarReminderOverrideInput, CalendarRemindersInput, CreateCalendarEventInput,
    DeleteCalendarEventInput, GraphqlCalendarAttendeeInput, GraphqlCalendarConferenceChange,
    GraphqlCalendarDeletionScope, GraphqlCalendarOutOfOfficeAutoDeclineMode,
    GraphqlCalendarRsvpScope, GraphqlCalendarUpdateScope, RespondToCalendarEventInput,
    TimedEventTimeInput, UpdateCalendarEventInput,
};
pub use objects::{
    GraphqlAllDayEventTime, GraphqlCalendar, GraphqlCalendarAttendee,
    GraphqlCalendarAttendeeResponseStatus, GraphqlCalendarChanges,
    GraphqlCalendarConferenceProvider, GraphqlCalendarEvent, GraphqlCalendarEventChange,
    GraphqlCalendarEventSource, GraphqlCalendarEventStatus, GraphqlCalendarEventTransparency,
    GraphqlCalendarEventType, GraphqlCalendarEventVisibility, GraphqlCalendarLinkWatermark,
    GraphqlCalendarMutationPayload, GraphqlCalendarOccurrence, GraphqlCalendarOccurrencePage,
    GraphqlCalendarReminderOverride, GraphqlCalendarReminders, GraphqlCalendarSyncStatus,
    GraphqlEventTime, GraphqlTimedEventTime,
};
pub use reads::CalendarGraphqlContext;
pub use user_query::GraphqlCalendarQuery;
pub use writes::CalendarGraphqlMutationContext;

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
