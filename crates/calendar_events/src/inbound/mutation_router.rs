//! Axum router for user-initiated calendar event mutations.
//!
//! Handlers are thin: they parse transport DTOs, forward the authenticated
//! requester to the domain mutation service, and map domain errors to HTTP
//! semantics. Authorization and business policy live in the domain layer.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{
        AttendeeResponseStatus, CalendarAttendeeInput, CalendarEvent, CalendarEventDraft,
        CalendarEventPatch, ConferenceChange, EventReminders, EventTime, EventTransparency,
        EventVisibility, OutOfOfficeProperties, VisibleCalendar,
    },
    ports::{
        CalendarDeletionScope, CalendarMutationError, CalendarMutationService, CalendarRsvpScope,
        CalendarUpdateScope,
    },
};

/// Router state for authenticated calendar mutations.
pub struct CalendarMutationRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for CalendarMutationRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> CalendarMutationRouterState<S, Auth> {
    /// Create router state from a shared mutation service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<CalendarMutationRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CalendarMutationRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the authenticated calendar mutation router, exposing `/calendars`
/// and `/events` (mounted under `/calendar` by the service).
pub fn calendar_mutation_router<S, Auth, T>(
    state: CalendarMutationRouterState<S, Auth>,
) -> Router<T>
where
    S: CalendarMutationService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/calendars", get(list_calendars::<S, Auth>))
        .route("/events", post(create_calendar_event::<S, Auth>))
        .route(
            "/events/{event_id}",
            patch(update_calendar_event::<S, Auth>).delete(delete_calendar_event::<S, Auth>),
        )
        .route(
            "/events/{event_id}/rsvp",
            put(rsvp_calendar_event::<S, Auth>),
        )
        .with_state(state)
}

/// An attendee supplied to a calendar mutation.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarAttendeeInputBody {
    /// Attendee email address.
    pub email: String,
    /// Whether attendance is optional.
    #[serde(default)]
    pub is_optional: bool,
}

impl From<CalendarAttendeeInputBody> for CalendarAttendeeInput {
    fn from(body: CalendarAttendeeInputBody) -> Self {
        Self {
            email: body.email,
            is_optional: body.is_optional,
            response_status: None,
        }
    }
}

/// Request body creating a calendar event on the requester's calendar.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCalendarEventRequest {
    /// Exact calendar to create the event on; takes precedence over the
    /// inbox default.
    pub calendar_id: Option<Uuid>,
    /// Connected inbox whose primary calendar receives the event; defaults
    /// to the requester's primary inbox.
    pub email_link_id: Option<Uuid>,
    /// Display title.
    pub title: String,
    /// Optional event body.
    pub description: Option<String>,
    /// Optional location label.
    pub location: Option<String>,
    /// Timed or all-day shape.
    pub time: EventTime,
    /// Invited attendees.
    #[serde(default)]
    pub attendees: Vec<CalendarAttendeeInputBody>,
    /// Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`).
    #[serde(default)]
    pub recurrence_lines: Vec<String>,
    /// Event visibility.
    pub visibility: Option<EventVisibility>,
    /// Availability behavior.
    pub transparency: Option<EventTransparency>,
    /// Reminder configuration; omit to keep the calendar defaults.
    pub reminders: Option<EventReminders>,
    /// Conference to attach to the new event; omit to create it without one.
    pub conference: Option<ConferenceChange>,
    /// Out-of-office properties; present to create the event as a Google
    /// out-of-office status event (primary calendar only, timed, no
    /// attendees), omitted for a regular event.
    pub out_of_office: Option<OutOfOfficeProperties>,
}

/// Request body patching an event; omitted fields are left untouched.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalendarEventRequest {
    /// Replacement title; an empty string clears it.
    pub title: Option<String>,
    /// Replacement description; an empty string clears it.
    pub description: Option<String>,
    /// Replacement location; an empty string clears it.
    pub location: Option<String>,
    /// Replacement time.
    pub time: Option<EventTime>,
    /// Replacement attendee list.
    pub attendees: Option<Vec<CalendarAttendeeInputBody>>,
    /// Replacement recurrence properties; an empty list clears them.
    pub recurrence_lines: Option<Vec<String>>,
    /// Replacement visibility.
    pub visibility: Option<EventVisibility>,
    /// Replacement transparency.
    pub transparency: Option<EventTransparency>,
    /// Replacement reminder configuration.
    pub reminders: Option<EventReminders>,
    /// Conference change: `google_meet` attaches a freshly generated Meet,
    /// `none` detaches the current conference, and omitting it leaves the
    /// conference untouched.
    ///
    /// A third-party conference is replaced or detached like any other, since
    /// the request is explicit. Omit the field to leave it alone.
    pub conference: Option<ConferenceChange>,
    /// Replacement out-of-office properties, applied only to an event that is
    /// already out-of-office — the provider event type is immutable. Omit to
    /// leave them untouched.
    pub out_of_office: Option<OutOfOfficeProperties>,
    /// How much of a recurring series the update covers. Omit to let
    /// `recurrenceId` decide: the identified occurrence alone when one is
    /// supplied, otherwise the whole event or series. An explicit
    /// `this_event` scope requires `recurrenceId`, so a scoped request is
    /// never silently widened to the series.
    pub scope: Option<CalendarUpdateScopeParam>,
    /// Original-start key of the occurrence the update targets.
    pub recurrence_id: Option<String>,
}

/// How much of a recurring series an update applies to.
///
/// Like RSVPs there is no this-and-following variant: the provider cannot
/// express a forward-scoped edit as one write, and emulating it (truncate
/// the series, insert an edited clone) is non-atomic and re-invites the
/// attendees of the clone. Compose it from a this-and-following deletion
/// and a create when that shape is wanted.
#[derive(Clone, Copy, Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarUpdateScopeParam {
    /// The entire event or series. A time change here moves every
    /// occurrence of a recurring series.
    All,
    /// One occurrence.
    ThisEvent,
}

/// How much of a recurring series a deletion removes.
#[derive(Clone, Copy, Debug, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarDeletionScopeParam {
    /// The entire event or series.
    #[default]
    All,
    /// One occurrence.
    ThisEvent,
    /// One occurrence and everything after it.
    ThisAndFollowing,
}

/// Query selecting how much of a recurring series a deletion removes.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCalendarEventQuery {
    /// Deletion scope; defaults to the entire event or series.
    #[serde(default)]
    pub scope: CalendarDeletionScopeParam,
    /// Original-start key of the occurrence a scoped deletion targets.
    pub recurrence_id: Option<String>,
}

/// How much of a recurring series an RSVP applies to.
///
/// Unlike deletion there is no this-and-following variant: the provider
/// cannot express a forward-scoped response, so offering one would be a
/// promise sync could not keep.
#[derive(Clone, Copy, Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarRsvpScopeParam {
    /// The entire series.
    All,
    /// One occurrence.
    ThisEvent,
}

/// Request body setting the requester's RSVP on an event.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RsvpCalendarEventRequest {
    /// The response to record for the connected account.
    pub response: AttendeeResponseStatus,
    /// How much of a recurring series the response covers. Omit to let
    /// `recurrenceId` decide: the identified occurrence alone when one is
    /// supplied, otherwise the whole series. An explicit `this_event` scope
    /// requires `recurrenceId`, so a scoped request is never silently
    /// widened to the series.
    pub scope: Option<CalendarRsvpScopeParam>,
    /// Original-start key of the occurrence the response targets.
    pub recurrence_id: Option<String>,
}

/// Machine-readable failure category for calendar mutations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarMutationErrorCode {
    /// The event does not exist or is not visible to the requester.
    NotFound,
    /// The targeted occurrence does not exist on the recurring event at the
    /// provider; the local projection was refreshed to match.
    OccurrenceNotFound,
    /// The containing calendar prohibits mutation.
    ReadOnly,
    /// No connected calendar can accept new events.
    NoWritableCalendar,
    /// The connected account is not an attendee of the event.
    NotAttendee,
    /// The request was invalid.
    InvalidInput,
    /// The calendar grant must be re-consented.
    ReauthRequired,
    /// The provider rejected the mutation.
    ProviderRejected,
    /// A transient failure; the mutation can be retried.
    Retryable,
    /// The provider applied the mutation but local persistence lagged;
    /// refetching converges.
    PersistFailed,
}

/// HTTP error body returned by calendar mutation endpoints.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CalendarMutationApiError {
    /// Machine-readable failure category.
    pub code: CalendarMutationErrorCode,
    /// Human-readable failure description.
    pub message: String,
    #[serde(skip)]
    status: StatusCode,
}

impl std::fmt::Display for CalendarMutationApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl IntoResponse for CalendarMutationApiError {
    fn into_response(self) -> Response {
        (self.status, Json(&self)).into_response()
    }
}

impl From<CalendarMutationError> for CalendarMutationApiError {
    fn from(error: CalendarMutationError) -> Self {
        let (status, code, message) = match &error {
            CalendarMutationError::NotFound => (
                StatusCode::NOT_FOUND,
                CalendarMutationErrorCode::NotFound,
                "calendar event was not found".to_string(),
            ),
            CalendarMutationError::OccurrenceNotFound => (
                StatusCode::NOT_FOUND,
                CalendarMutationErrorCode::OccurrenceNotFound,
                "the targeted occurrence was not found on the recurring event; the calendar \
                 was out of date and has been refreshed"
                    .to_string(),
            ),
            CalendarMutationError::ReadOnly => (
                StatusCode::FORBIDDEN,
                CalendarMutationErrorCode::ReadOnly,
                "this calendar is read-only".to_string(),
            ),
            CalendarMutationError::NoWritableCalendar => (
                StatusCode::CONFLICT,
                CalendarMutationErrorCode::NoWritableCalendar,
                "no connected calendar can accept new events".to_string(),
            ),
            CalendarMutationError::NotAttendee => (
                StatusCode::CONFLICT,
                CalendarMutationErrorCode::NotAttendee,
                "the connected account is not an attendee of this event".to_string(),
            ),
            CalendarMutationError::InvalidInput(message) => (
                StatusCode::BAD_REQUEST,
                CalendarMutationErrorCode::InvalidInput,
                message.clone(),
            ),
            CalendarMutationError::ReauthRequired(_) => (
                StatusCode::FORBIDDEN,
                CalendarMutationErrorCode::ReauthRequired,
                "calendar access must be re-authorized".to_string(),
            ),
            CalendarMutationError::ProviderRejected(message) => (
                StatusCode::CONFLICT,
                CalendarMutationErrorCode::ProviderRejected,
                message.clone(),
            ),
            CalendarMutationError::Retryable(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                CalendarMutationErrorCode::Retryable,
                "the calendar mutation failed transiently; try again".to_string(),
            ),
            CalendarMutationError::PersistFailed(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                CalendarMutationErrorCode::PersistFailed,
                "the change reached the calendar provider; refresh to see it".to_string(),
            ),
        };
        if matches!(
            error,
            CalendarMutationError::Retryable(_) | CalendarMutationError::PersistFailed(_)
        ) {
            tracing::error!(error=?error, "calendar mutation failed");
        }
        Self {
            code,
            message,
            status,
        }
    }
}

/// Create a calendar event and return its synced entity.
#[tracing::instrument(skip_all, err)]
#[utoipa::path(
    post,
    path = "/calendar/events",
    tag = "calendar_events",
    request_body = CreateCalendarEventRequest,
    responses(
        (status = 201, description = "The created calendar event", body = CalendarEvent),
        (status = 400, description = "Invalid event fields", body = CalendarMutationApiError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization", body = CalendarMutationApiError),
        (status = 409, description = "No writable calendar or the provider rejected the event", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn create_calendar_event<S, Auth>(
    State(state): State<CalendarMutationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<CreateCalendarEventRequest>,
) -> Result<(StatusCode, Json<CalendarEvent>), CalendarMutationApiError>
where
    S: CalendarMutationService,
    Auth: MacroAuthorizationService,
{
    let draft = CalendarEventDraft {
        title: request.title,
        description: request.description,
        location: request.location,
        time: request.time,
        attendees: request.attendees.into_iter().map(Into::into).collect(),
        recurrence_lines: request.recurrence_lines,
        visibility: request.visibility,
        transparency: request.transparency,
        reminders: request.reminders,
        conference: request.conference,
        out_of_office: request.out_of_office,
    };
    let event = state
        .service
        .create_event(
            user.authorization.user.macro_user_id.as_ref(),
            request.email_link_id,
            request.calendar_id,
            draft,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(event)))
}

/// Calendars visible to the requester across connected and delegated inboxes.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCalendarsResponse {
    /// Primaries and writable calendars first.
    pub calendars: Vec<VisibleCalendar>,
}

/// List the requester's visible calendars for pickers and filters.
#[tracing::instrument(skip_all, err)]
#[utoipa::path(
    get,
    path = "/calendar/calendars",
    tag = "calendar_events",
    responses(
        (status = 200, description = "Calendars visible to the requester", body = ListCalendarsResponse),
        (status = 401, description = "Authentication required"),
        (status = 503, description = "Transient failure", body = CalendarMutationApiError),
    )
)]
pub async fn list_calendars<S, Auth>(
    State(state): State<CalendarMutationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<ListCalendarsResponse>, CalendarMutationApiError>
where
    S: CalendarMutationService,
    Auth: MacroAuthorizationService,
{
    let calendars = state
        .service
        .list_visible_calendars(user.authorization.user.macro_user_id.as_ref())
        .await?;
    Ok(Json(ListCalendarsResponse { calendars }))
}

/// Resolve an update's scope from its transport pair. An omitted scope
/// defers to `recurrenceId`; contradictory pairs are rejected so a
/// one-occurrence intent is never silently widened to the series and a
/// series intent never carries a dangling occurrence key.
fn update_scope(
    scope: Option<CalendarUpdateScopeParam>,
    recurrence_id: Option<String>,
) -> Result<CalendarUpdateScope, CalendarMutationApiError> {
    match (scope, recurrence_id) {
        (Some(CalendarUpdateScopeParam::All), None) | (None, None) => Ok(CalendarUpdateScope::All),
        (Some(CalendarUpdateScopeParam::ThisEvent), Some(recurrence_id))
        | (None, Some(recurrence_id)) => Ok(CalendarUpdateScope::ThisEvent { recurrence_id }),
        (Some(CalendarUpdateScopeParam::ThisEvent), None) => Err(CalendarMutationApiError {
            code: CalendarMutationErrorCode::InvalidInput,
            message: "a this-event update requires recurrenceId".to_string(),
            status: StatusCode::BAD_REQUEST,
        }),
        (Some(CalendarUpdateScopeParam::All), Some(_)) => Err(CalendarMutationApiError {
            code: CalendarMutationErrorCode::InvalidInput,
            message: "recurrenceId only applies to a this_event update".to_string(),
            status: StatusCode::BAD_REQUEST,
        }),
    }
}

/// Update fields of a calendar event and return its synced entity.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    patch,
    path = "/calendar/events/{event_id}",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Calendar event entity id")),
    request_body = UpdateCalendarEventRequest,
    responses(
        (status = 200, description = "The updated calendar event", body = CalendarEvent),
        (status = 400, description = "Invalid event fields", body = CalendarMutationApiError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization", body = CalendarMutationApiError),
        (status = 404, description = "Event or targeted occurrence not found", body = CalendarMutationApiError),
        (status = 409, description = "The provider rejected the update", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn update_calendar_event<S, Auth>(
    State(state): State<CalendarMutationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Json(request): Json<UpdateCalendarEventRequest>,
) -> Result<Json<CalendarEvent>, CalendarMutationApiError>
where
    S: CalendarMutationService,
    Auth: MacroAuthorizationService,
{
    let scope = update_scope(request.scope, request.recurrence_id)?;
    let patch = CalendarEventPatch {
        title: request.title,
        description: request.description,
        location: request.location,
        time: request.time,
        attendees: request
            .attendees
            .map(|attendees| attendees.into_iter().map(Into::into).collect()),
        recurrence_lines: request.recurrence_lines,
        visibility: request.visibility,
        transparency: request.transparency,
        reminders: request.reminders,
        conference: request.conference,
        out_of_office: request.out_of_office,
    };
    let event = state
        .service
        .update_event(
            user.authorization.user.macro_user_id.as_ref(),
            event_id,
            patch,
            scope,
        )
        .await?;
    Ok(Json(event))
}

/// Delete a calendar event at its provider.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    delete,
    path = "/calendar/events/{event_id}",
    tag = "calendar_events",
    params(
        ("event_id" = Uuid, Path, description = "Calendar event entity id"),
        DeleteCalendarEventQuery,
    ),
    responses(
        (status = 204, description = "The event was deleted"),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization", body = CalendarMutationApiError),
        (status = 404, description = "Event not found", body = CalendarMutationApiError),
        (status = 409, description = "The provider rejected the deletion", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn delete_calendar_event<S, Auth>(
    State(state): State<CalendarMutationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Query(query): Query<DeleteCalendarEventQuery>,
) -> Result<StatusCode, CalendarMutationApiError>
where
    S: CalendarMutationService,
    Auth: MacroAuthorizationService,
{
    let scoped_occurrence = |kind: &'static str| {
        query.recurrence_id.clone().ok_or(CalendarMutationApiError {
            code: CalendarMutationErrorCode::InvalidInput,
            message: format!("a {kind} deletion requires recurrenceId"),
            status: StatusCode::BAD_REQUEST,
        })
    };
    let scope = match query.scope {
        CalendarDeletionScopeParam::All => CalendarDeletionScope::All,
        CalendarDeletionScopeParam::ThisEvent => CalendarDeletionScope::ThisEvent {
            recurrence_id: scoped_occurrence("this-event")?,
        },
        CalendarDeletionScopeParam::ThisAndFollowing => CalendarDeletionScope::ThisAndFollowing {
            recurrence_id: scoped_occurrence("this-and-following")?,
        },
    };
    state
        .service
        .delete_event(
            user.authorization.user.macro_user_id.as_ref(),
            event_id,
            scope,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Set the requester's RSVP on a calendar event and return its synced entity.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    put,
    path = "/calendar/events/{event_id}/rsvp",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Calendar event entity id")),
    request_body = RsvpCalendarEventRequest,
    responses(
        (status = 200, description = "The updated calendar event", body = CalendarEvent),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization", body = CalendarMutationApiError),
        (status = 404, description = "Event not found", body = CalendarMutationApiError),
        (status = 409, description = "The connected account is not an attendee", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn rsvp_calendar_event<S, Auth>(
    State(state): State<CalendarMutationRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Json(request): Json<RsvpCalendarEventRequest>,
) -> Result<Json<CalendarEvent>, CalendarMutationApiError>
where
    S: CalendarMutationService,
    Auth: MacroAuthorizationService,
{
    let scope = match (request.scope, request.recurrence_id) {
        (Some(CalendarRsvpScopeParam::All), _) | (None, None) => CalendarRsvpScope::All,
        (Some(CalendarRsvpScopeParam::ThisEvent), Some(recurrence_id))
        | (None, Some(recurrence_id)) => CalendarRsvpScope::ThisEvent { recurrence_id },
        (Some(CalendarRsvpScopeParam::ThisEvent), None) => {
            return Err(CalendarMutationApiError {
                code: CalendarMutationErrorCode::InvalidInput,
                message: "a this-event response requires recurrenceId".to_string(),
                status: StatusCode::BAD_REQUEST,
            });
        }
    };
    let event = state
        .service
        .respond_to_event(
            user.authorization.user.macro_user_id.as_ref(),
            event_id,
            request.response,
            scope,
        )
        .await?;
    Ok(Json(event))
}
