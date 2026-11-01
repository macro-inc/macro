//! Thin email authorization boundary for calendar invitation resolution.
use super::context::{ApiContext, AuthorizationService, EmailEntityAccessService};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use calendar_events::{
    domain::{invitations::InvitationResolution, models::CalendarEvent},
    inbound::mutation_router::{CalendarMutationApiError, CopyCalendarEventRequest},
};
use entity_access::{
    domain::models::ViewAccessLevel, inbound::axum_extractors::ThreadAccessLevelExtractor,
};
use std::collections::HashMap;
use uuid::Uuid;

#[utoipa::path(get, path = "/email/threads/{thread_id}/calendar-invitations", tag = "email",
    operation_id = "get_thread_calendar_invitations",
    params(("thread_id" = uuid::Uuid, Path, description = "Authorized email thread")),
    responses((status = 200, body = HashMap<String, InvitationResolution>), (status = 401), (status = 403)))]
pub(crate) async fn handler(
    State(state): State<ApiContext>,
    access: ThreadAccessLevelExtractor<
        ViewAccessLevel,
        EmailEntityAccessService,
        AuthorizationService,
    >,
) -> Result<Json<HashMap<String, InvitationResolution>>, StatusCode> {
    email::domain::invitation_resolution::resolve(
        state.invitation_resolver.as_ref(),
        &state.invitation_snapshots,
        access.entity_access_receipt,
    )
    .await
    .map(Json)
    .map_err(|error| {
        tracing::error!(error=?error, "invitation resolution failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })
}

/// Add a shared event saved from one of the thread's messages to one of the
/// viewer's Google calendars, the way Add to calendar adds a channel-shared
/// event: a snapshot under the meeting's iCalendar UID and organizer, with the
/// viewer as its only guest and no join link. Nobody is notified. Only a
/// published event file (`METHOD:PUBLISH`) can be added; an invitation is
/// answered from the calendar it reached.
#[utoipa::path(post,
    path = "/email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy",
    tag = "email",
    operation_id = "copy_thread_calendar_invitation",
    params(
        ("thread_id" = Uuid, Path, description = "Authorized email thread"),
        ("message_id" = Uuid, Path, description = "Message carrying the event"),
        ("invitation_id" = String, Path, description = "Saved event within the message"),
    ),
    request_body = CopyCalendarEventRequest,
    responses(
        (status = 201, description = "The copy on the viewer's calendar", body = CalendarEvent),
        (status = 400, description = "The saved event cannot be added, or the calendar is not a Google calendar", body = CalendarMutationApiError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization", body = CalendarMutationApiError),
        (status = 404, description = "No such saved event in the thread", body = CalendarMutationApiError),
        (status = 409, description = "Already on the viewer's calendar, no writable calendar, or the provider refused the copy", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    ))]
pub(crate) async fn copy_handler(
    State(state): State<ApiContext>,
    access: ThreadAccessLevelExtractor<
        ViewAccessLevel,
        EmailEntityAccessService,
        AuthorizationService,
    >,
    Path((_thread_id, message_id, invitation_id)): Path<(Uuid, Uuid, String)>,
    Json(request): Json<CopyCalendarEventRequest>,
) -> Result<(StatusCode, Json<CalendarEvent>), CalendarMutationApiError> {
    let event = email::domain::invitation_import::add_to_calendar(
        state.calendar_mutation_service.as_ref(),
        &state.invitation_snapshots,
        access.entity_access_receipt,
        message_id,
        &invitation_id,
        request.calendar_id,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(event)))
}
