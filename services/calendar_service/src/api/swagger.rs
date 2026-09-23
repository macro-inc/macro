use utoipa::OpenApi;

/// OpenAPI document for the calendar service.
///
/// The calendar mutation operations live in the shared `calendar_events` crate.
/// Their paths are root-relative; clients carry the `/calendar` gateway prefix
/// in their base URL.
#[derive(OpenApi)]
#[openapi(
    paths(
        crate::health::health_handler,
        calendar_events::inbound::mutation_router::list_calendars,
        calendar_events::inbound::mutation_router::create_calendar_event,
        calendar_events::inbound::mutation_router::update_calendar_event,
        calendar_events::inbound::mutation_router::delete_calendar_event,
        calendar_events::inbound::mutation_router::rsvp_calendar_event,
    ),
    components(schemas(
        calendar_events::inbound::mutation_router::CreateCalendarEventRequest,
        calendar_events::inbound::mutation_router::ListCalendarsResponse,
        calendar_events::domain::models::VisibleCalendar,
        calendar_events::inbound::mutation_router::UpdateCalendarEventRequest,
        calendar_events::inbound::mutation_router::RsvpCalendarEventRequest,
        calendar_events::inbound::mutation_router::CalendarAttendeeInputBody,
        calendar_events::inbound::mutation_router::CalendarMutationApiError,
        calendar_events::inbound::mutation_router::CalendarMutationErrorCode,
        calendar_events::inbound::mutation_router::CalendarDeletionScopeParam,
        calendar_events::inbound::mutation_router::CalendarUpdateScopeParam,
        calendar_events::domain::models::CalendarEvent,
        calendar_events::domain::models::CalendarAttendee,
        calendar_events::domain::models::AttendeeResponseStatus,
        calendar_events::domain::models::EventTime,
        calendar_events::domain::models::EventStatus,
        calendar_events::domain::models::EventVisibility,
        calendar_events::domain::models::EventTransparency,
        calendar_events::domain::models::RefreshCalendarEvent,
    )),
    tags((name = "calendar_events", description = "Macro Calendar Service"))
)]
pub struct ApiDoc;
