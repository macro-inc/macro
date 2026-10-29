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
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    copies::{CopyChange, CopyRefusal},
    join_requests::CalendarJoinRequest,
    meeting_links::{
        CreateEventWithMacroCallError, MeetingLinkError, create_event_with_macro_call,
    },
    models::{
        AttendeeResponseStatus, CalendarAttendeeInput, CalendarEvent, CalendarEventDraft,
        CalendarEventPatch, ConferenceChange, EventReminders, EventTime, EventTransparency,
        EventVisibility, GuestPolicy, OutOfOfficeProperties, VisibleCalendar,
    },
    ports::{
        CalendarCopyConfirmation, CalendarDeletionScope, CalendarMutationError,
        CalendarMutationService, CalendarRsvpScope, CalendarUpdateScope, MeetingLinkProvider,
    },
};

/// Router state for authenticated calendar mutations.
pub struct CalendarMutationRouterState<S, L, Auth> {
    service: Arc<S>,
    meeting_links: Arc<L>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, L, Auth> Clone for CalendarMutationRouterState<S, L, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            meeting_links: Arc::clone(&self.meeting_links),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, L, Auth> CalendarMutationRouterState<S, L, Auth> {
    /// Create router state from a shared mutation service, the meeting-link
    /// provider minting Macro calls for new events, and authorization state.
    pub fn new(
        service: Arc<S>,
        meeting_links: Arc<L>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            meeting_links,
            authorization_state,
        }
    }
}

impl<S, L, Auth> FromRef<CalendarMutationRouterState<S, L, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &CalendarMutationRouterState<S, L, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the authenticated calendar mutation router, exposing `/calendars`
/// and `/events` (mounted under `/calendar` by the service).
pub fn calendar_mutation_router<S, L, Auth, T>(
    state: CalendarMutationRouterState<S, L, Auth>,
) -> Router<T>
where
    S: CalendarMutationService + CalendarCopyConfirmation,
    L: MeetingLinkProvider,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/calendars", get(list_calendars::<S, L, Auth>))
        .route("/events", post(create_calendar_event::<S, L, Auth>))
        .route(
            "/events/{event_id}",
            patch(update_calendar_event::<S, L, Auth>).delete(delete_calendar_event::<S, L, Auth>),
        )
        .route(
            "/events/{event_id}/rsvp",
            put(rsvp_calendar_event::<S, L, Auth>),
        )
        .route(
            "/events/{event_id}/guests",
            post(invite_calendar_event_guests::<S, L, Auth>),
        )
        .route(
            "/events/{event_id}/copy",
            post(copy_calendar_event::<S, L, Auth>),
        )
        .route(
            "/join-requests/{request_id}",
            put(respond_to_join_request::<S, L, Auth>),
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
    /// Stable retry identity, scoped to the authenticated organizer.
    pub idempotency_key: Option<Uuid>,
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
    /// Mint a Macro call and write its join link into the description and
    /// location before creating the event, so the invitation carries it.
    /// Cannot be combined with `conference`.
    #[serde(default)]
    pub macro_call: bool,
    /// Out-of-office properties; present to create the event as a Google
    /// out-of-office status event (primary calendar only, timed, no
    /// attendees), omitted for a regular event.
    pub out_of_office: Option<OutOfOfficeProperties>,
    /// What guests may do; omit for Google's defaults (guests may invite
    /// others and see the guest list, not modify the event). Google
    /// calendars only.
    pub guest_policy: Option<GuestPolicy>,
}

/// Request body patching an event; omitted fields are left untouched.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalendarEventRequest {
    /// Calendar whose copy of the event is patched, for an event synced from
    /// more than one calendar. Omit to patch the canonical copy.
    pub calendar_id: Option<Uuid>,
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
    /// Replacement guest policy; only the organizer of a Google event may
    /// change it, for the whole event or series. Omit to leave it untouched.
    pub guest_policy: Option<GuestPolicy>,
    /// How much of a recurring series the update covers. Omit to let
    /// `recurrenceId` decide: the identified occurrence alone when one is
    /// supplied, otherwise the whole event or series. An explicit
    /// `this_event` scope requires `recurrenceId`, so a scoped request is
    /// never silently widened to the series.
    pub scope: Option<CalendarUpdateScopeParam>,
    /// Original-start key of the occurrence the update targets.
    pub recurrence_id: Option<String>,
    /// Inbox address holding the copy this request changes. An agent run
    /// must name it when the meeting is on more than one of the requester's
    /// inboxes, and it must be the inbox holding the addressed copy; a
    /// mismatch is refused whoever sends it.
    pub inbox: Option<String>,
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
    /// Calendar whose copy of the event is deleted, for an event synced from
    /// more than one calendar. Omit to delete the canonical copy.
    pub calendar_id: Option<Uuid>,
    /// Deletion scope; defaults to the entire event or series.
    #[serde(default)]
    pub scope: CalendarDeletionScopeParam,
    /// Original-start key of the occurrence a scoped deletion targets.
    pub recurrence_id: Option<String>,
    /// Inbox address holding the copy this request deletes. An agent run
    /// must name it when the meeting is on more than one of the requester's
    /// inboxes, and it must be the inbox holding the addressed copy; a
    /// mismatch is refused whoever sends it.
    pub inbox: Option<String>,
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
    /// The owned connected address whose attendance is changed. Validated by the domain.
    /// Omit to answer as the inbox the addressed copy syncs through.
    pub responding_email: Option<String>,
    /// Calendar whose copy of the event is answered, for an event synced
    /// from more than one calendar. Omit to answer on the canonical copy.
    pub calendar_id: Option<Uuid>,
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

/// A guest added to an event.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarGuestInputBody {
    /// Guest email address.
    pub email: String,
    /// Whether attendance is optional.
    #[serde(default)]
    pub optional: bool,
}

impl From<CalendarGuestInputBody> for CalendarAttendeeInput {
    fn from(body: CalendarGuestInputBody) -> Self {
        Self {
            email: body.email,
            is_optional: body.optional,
            response_status: None,
        }
    }
}

/// Request body adding guests to an event without touching anyone already
/// invited.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InviteCalendarEventGuestsRequest {
    /// Calendar whose copy of the event is written, for an event synced from
    /// more than one calendar. Omit to write the canonical copy.
    pub calendar_id: Option<Uuid>,
    /// Guests to add; anyone already on the event is skipped.
    pub guests: Vec<CalendarGuestInputBody>,
    /// How much of a recurring series gains the guests. Omit to let
    /// `recurrenceId` decide: the identified occurrence alone when one is
    /// supplied, otherwise the whole event or series. An explicit
    /// `this_event` scope requires `recurrenceId`.
    pub scope: Option<CalendarUpdateScopeParam>,
    /// Original-start key of the occurrence the guests are added to.
    pub recurrence_id: Option<String>,
    /// Inbox address holding the copy this request changes. An agent run
    /// must name it when the meeting is on more than one of the requester's
    /// inboxes, and it must be the inbox holding the addressed copy; a
    /// mismatch is refused whoever sends it.
    pub inbox: Option<String>,
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
    /// Only the organizer may change the event's guest policy.
    NotOrganizer,
    /// Only the organizer may invite guests: the organizer does not let
    /// guests invite others, or the event is an Outlook meeting.
    GuestsCannotInvite,
    /// The organizer hides the guest list, so a guest cannot add guests.
    GuestListHidden,
    /// The organizer does not let guests change the event's details.
    GuestsCannotModify,
    /// The meeting is already on one of the requester's calendars.
    AlreadyOnCalendar,
    /// The requester asked to join the event and the request is pending or
    /// accepted, so the meeting reaches their calendar as an invitation.
    JoinRequestOpen,
    /// The provider refused to add a copy of the event to the calendar.
    CopyRefused,
    /// The event is a snapshot of a shared meeting, so an answer or a new
    /// guest would never reach the meeting.
    Snapshot,
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
    /// The Macro call for a new event could not be created; nothing was
    /// written to the calendar.
    MacroCallFailed,
    /// The meeting is on several of the requester's inboxes and the agent
    /// run did not name the inbox of the copy it changes, or named another
    /// copy's; the message lists each copy's inbox, role and id.
    CopyChoiceRequired,
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

impl From<CopyRefusal> for CalendarMutationApiError {
    fn from(refusal: CopyRefusal) -> Self {
        Self {
            code: CalendarMutationErrorCode::CopyChoiceRequired,
            message: refusal.message().to_string(),
            status: StatusCode::CONFLICT,
        }
    }
}

/// Set by the code-mode runtime (`code_execution`'s `bootstrap.mjs`) on every
/// authenticated SDK request a program makes, in agent sessions and for
/// public MCP clients alike.
const CODE_EXECUTION_HEADER: &str = "x-macro-code-execution";

/// Whether a request comes from an agent's program rather than a person in
/// the app: a code-mode run, or a token carrying an agent's attribution.
fn is_agent_run(agent_attributed: bool, headers: &HeaderMap) -> bool {
    agent_attributed || headers.contains_key(CODE_EXECUTION_HEADER)
}

/// Make an agent run name the copy it changes when the meeting is on several
/// of the requester's inboxes. The web picks a copy by opening it, so a
/// request that is not an agent run and names no `inbox` is not checked; a
/// request naming `inbox` is checked whoever sends it.
async fn confirm_copy<S: CalendarCopyConfirmation>(
    service: &S,
    requester_id: &str,
    is_agent_run: bool,
    event_id: Uuid,
    inbox: Option<&str>,
    change: CopyChange,
) -> Result<(), CalendarMutationApiError> {
    if !is_agent_run && inbox.is_none() {
        return Ok(());
    }
    match service
        .confirm_copy(requester_id, event_id, inbox, change)
        .await?
    {
        None => Ok(()),
        Some(refusal) => Err(refusal.into()),
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
            CalendarMutationError::NotOrganizer => (
                StatusCode::FORBIDDEN,
                CalendarMutationErrorCode::NotOrganizer,
                "Only the organizer can change guest permissions.".to_string(),
            ),
            CalendarMutationError::GuestsCannotInvite => (
                StatusCode::FORBIDDEN,
                CalendarMutationErrorCode::GuestsCannotInvite,
                "Only the organizer can invite guests to this event.".to_string(),
            ),
            CalendarMutationError::GuestListHidden => (
                StatusCode::FORBIDDEN,
                CalendarMutationErrorCode::GuestListHidden,
                "Guests cannot be added while the organizer hides the guest list.".to_string(),
            ),
            CalendarMutationError::GuestsCannotModify => (
                StatusCode::FORBIDDEN,
                CalendarMutationErrorCode::GuestsCannotModify,
                "The organizer doesn't let guests change this event.".to_string(),
            ),
            CalendarMutationError::AlreadyOnCalendar => (
                StatusCode::CONFLICT,
                CalendarMutationErrorCode::AlreadyOnCalendar,
                "This meeting is already on one of your calendars, so it can't be added to \
                 another one."
                    .to_string(),
            ),
            CalendarMutationError::JoinRequestOpen => (
                StatusCode::CONFLICT,
                CalendarMutationErrorCode::JoinRequestOpen,
                "You've asked to join this event, so it reaches your calendar as an invitation \
                 once you're added as a guest."
                    .to_string(),
            ),
            CalendarMutationError::CopyRefused(_) => (
                StatusCode::CONFLICT,
                CalendarMutationErrorCode::CopyRefused,
                "Google Calendar won't add a copy of this event to that calendar.".to_string(),
            ),
            CalendarMutationError::Snapshot => (
                StatusCode::FORBIDDEN,
                CalendarMutationErrorCode::Snapshot,
                "This is your own copy of a shared event, so answers and guests won't reach its organizer.".to_string(),
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

impl From<CreateEventWithMacroCallError> for CalendarMutationApiError {
    fn from(error: CreateEventWithMacroCallError) -> Self {
        match error {
            CreateEventWithMacroCallError::Calendar(error) => error.into(),
            CreateEventWithMacroCallError::MeetingLink(MeetingLinkError::InvalidInput(message)) => {
                Self {
                    code: CalendarMutationErrorCode::InvalidInput,
                    message,
                    status: StatusCode::BAD_REQUEST,
                }
            }
            CreateEventWithMacroCallError::MeetingLink(error) => {
                tracing::error!(error = ?error, "calendar event macro call creation failed");
                Self {
                    code: CalendarMutationErrorCode::MacroCallFailed,
                    message: "the Macro call for the event could not be created; the event was \
                              not saved"
                        .to_string(),
                    status: StatusCode::SERVICE_UNAVAILABLE,
                }
            }
        }
    }
}

/// Create a calendar event and return its synced entity.
#[tracing::instrument(skip_all, err)]
#[utoipa::path(
    post,
    path = "/events",
    tag = "calendar_events",
    request_body = CreateCalendarEventRequest,
    responses(
        (status = 201, description = "The created calendar event", body = CalendarEvent),
        (status = 400, description = "Invalid event fields", body = CalendarMutationApiError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization", body = CalendarMutationApiError),
        (status = 409, description = "No writable calendar or the provider rejected the event", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure, or the Macro call could not be created", body = CalendarMutationApiError),
    )
)]
pub async fn create_calendar_event<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<CreateCalendarEventRequest>,
) -> Result<(StatusCode, Json<CalendarEvent>), CalendarMutationApiError>
where
    S: CalendarMutationService,
    L: MeetingLinkProvider,
    Auth: MacroAuthorizationService,
{
    let draft = CalendarEventDraft {
        idempotency_key: request.idempotency_key,
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
        guest_policy: request.guest_policy,
    };
    let requester_id: &str = user.authorization.user.macro_user_id.as_ref();
    let event = if request.macro_call {
        create_event_with_macro_call(
            &*state.service,
            &*state.meeting_links,
            requester_id,
            request.email_link_id,
            request.calendar_id,
            draft,
        )
        .await?
        .event
    } else {
        state
            .service
            .create_event(
                requester_id,
                request.email_link_id,
                request.calendar_id,
                draft,
            )
            .await?
    };
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
    path = "/calendars",
    tag = "calendar_events",
    responses(
        (status = 200, description = "Calendars visible to the requester", body = ListCalendarsResponse),
        (status = 401, description = "Authentication required"),
        (status = 503, description = "Transient failure", body = CalendarMutationApiError),
    )
)]
pub async fn list_calendars<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<ListCalendarsResponse>, CalendarMutationApiError>
where
    S: CalendarMutationService,
    L: MeetingLinkProvider,
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
    path = "/events/{event_id}",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Calendar event entity id")),
    request_body = UpdateCalendarEventRequest,
    responses(
        (status = 200, description = "The updated calendar event", body = CalendarEvent),
        (status = 400, description = "Invalid event fields", body = CalendarMutationApiError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization, or the event is a snapshot of a shared meeting", body = CalendarMutationApiError),
        (status = 404, description = "Event or targeted occurrence not found", body = CalendarMutationApiError),
        (status = 409, description = "The provider rejected the update", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn update_calendar_event<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    headers: HeaderMap,
    Path(event_id): Path<Uuid>,
    Json(request): Json<UpdateCalendarEventRequest>,
) -> Result<Json<CalendarEvent>, CalendarMutationApiError>
where
    S: CalendarMutationService + CalendarCopyConfirmation,
    L: MeetingLinkProvider,
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
        guest_policy: request.guest_policy,
    };
    let requester_id = user.authorization.user.macro_user_id.as_ref();
    // Reminders and availability belong to one copy, so only a change that
    // reaches the meeting needs the copy named.
    if patch.reaches_meeting() || request.inbox.is_some() {
        confirm_copy(
            &*state.service,
            requester_id,
            is_agent_run(user.authorization.user.agent_id.is_some(), &headers),
            event_id,
            request.inbox.as_deref(),
            CopyChange::Update {
                changes_guests: patch.attendees.is_some(),
            },
        )
        .await?;
    }
    let event = state
        .service
        .update_event(requester_id, event_id, request.calendar_id, patch, scope)
        .await?;
    Ok(Json(event))
}

/// Delete a calendar event at its provider.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    delete,
    path = "/events/{event_id}",
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
pub async fn delete_calendar_event<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    headers: HeaderMap,
    Path(event_id): Path<Uuid>,
    Query(query): Query<DeleteCalendarEventQuery>,
) -> Result<StatusCode, CalendarMutationApiError>
where
    S: CalendarMutationService + CalendarCopyConfirmation,
    L: MeetingLinkProvider,
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
    let requester_id = user.authorization.user.macro_user_id.as_ref();
    confirm_copy(
        &*state.service,
        requester_id,
        is_agent_run(user.authorization.user.agent_id.is_some(), &headers),
        event_id,
        query.inbox.as_deref(),
        CopyChange::Delete,
    )
    .await?;
    state
        .service
        .delete_event(requester_id, event_id, query.calendar_id, scope)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Set the requester's RSVP on a calendar event and return its synced entity.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    put,
    path = "/events/{event_id}/rsvp",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Calendar event entity id")),
    request_body = RsvpCalendarEventRequest,
    responses(
        (status = 200, description = "The updated calendar event", body = CalendarEvent),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization, or the event is a snapshot of a shared meeting", body = CalendarMutationApiError),
        (status = 404, description = "Event not found", body = CalendarMutationApiError),
        (status = 409, description = "The connected account is not an attendee", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn rsvp_calendar_event<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Json(request): Json<RsvpCalendarEventRequest>,
) -> Result<Json<CalendarEvent>, CalendarMutationApiError>
where
    S: CalendarMutationService,
    L: MeetingLinkProvider,
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
            request.calendar_id,
            request.response,
            scope,
            request.responding_email,
        )
        .await?;
    Ok(Json(event))
}

/// Add guests to a calendar event without touching anyone already invited,
/// and return its synced entity. The organizer, and guests the organizer lets
/// invite others, may call it; Google emails the new guests.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    post,
    path = "/events/{event_id}/guests",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Calendar event entity id")),
    request_body = InviteCalendarEventGuestsRequest,
    responses(
        (status = 200, description = "The updated calendar event", body = CalendarEvent),
        (status = 400, description = "Invalid guests or scope", body = CalendarMutationApiError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only, only the organizer can invite guests, the event is a snapshot of a shared meeting, or the calendar needs reauthorization", body = CalendarMutationApiError),
        (status = 404, description = "Event or occurrence not found", body = CalendarMutationApiError),
        (status = 409, description = "The connected account neither organizes nor attends the event", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn invite_calendar_event_guests<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    headers: HeaderMap,
    Path(event_id): Path<Uuid>,
    Json(request): Json<InviteCalendarEventGuestsRequest>,
) -> Result<Json<CalendarEvent>, CalendarMutationApiError>
where
    S: CalendarMutationService + CalendarCopyConfirmation,
    L: MeetingLinkProvider,
    Auth: MacroAuthorizationService,
{
    let scope = match (request.scope, request.recurrence_id) {
        (Some(CalendarUpdateScopeParam::All), _) | (None, None) => CalendarUpdateScope::All,
        (Some(CalendarUpdateScopeParam::ThisEvent), Some(recurrence_id))
        | (None, Some(recurrence_id)) => CalendarUpdateScope::ThisEvent { recurrence_id },
        (Some(CalendarUpdateScopeParam::ThisEvent), None) => {
            return Err(CalendarMutationApiError {
                code: CalendarMutationErrorCode::InvalidInput,
                message: "a this-event invite requires recurrenceId".to_string(),
                status: StatusCode::BAD_REQUEST,
            });
        }
    };
    let requester_id = user.authorization.user.macro_user_id.as_ref();
    confirm_copy(
        &*state.service,
        requester_id,
        is_agent_run(user.authorization.user.agent_id.is_some(), &headers),
        event_id,
        request.inbox.as_deref(),
        CopyChange::InviteGuests,
    )
    .await?;
    let event = state
        .service
        .invite_guests(
            requester_id,
            event_id,
            request.calendar_id,
            request.guests.into_iter().map(Into::into).collect(),
            scope,
        )
        .await?;
    Ok(Json(event))
}

/// Request body adding a shared event to the requester's calendar.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CopyCalendarEventRequest {
    /// Google calendar to add the copy to; defaults to the requester's
    /// primary inbox's primary calendar.
    pub calendar_id: Option<Uuid>,
}

/// Add a snapshot of an event shared with one of the requester's channels to
/// one of their Google calendars and return the synced snapshot. The
/// snapshot keeps the meeting's iCalendar UID and organizer, lists only the
/// requester as a guest, and carries no join link; nobody is notified.
/// While the requester's request to join the event is pending or accepted,
/// the copy is refused with `join_request_open`: the meeting reaches their
/// calendar as the invitation, which a copy would otherwise take in.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    post,
    path = "/events/{event_id}/copy",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Shared calendar event entity id")),
    request_body = CopyCalendarEventRequest,
    responses(
        (status = 201, description = "The copy on the requester's calendar", body = CalendarEvent),
        (status = 400, description = "The event cannot be copied, or the calendar is not a Google calendar", body = CalendarMutationApiError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only or needs reauthorization", body = CalendarMutationApiError),
        (status = 404, description = "Event not found or not shared with the requester", body = CalendarMutationApiError),
        (status = 409, description = "Already on the requester's calendar, a request to join it is pending or accepted, no writable calendar, or the provider refused the copy", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn copy_calendar_event<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Json(request): Json<CopyCalendarEventRequest>,
) -> Result<(StatusCode, Json<CalendarEvent>), CalendarMutationApiError>
where
    S: CalendarMutationService,
    L: MeetingLinkProvider,
    Auth: MacroAuthorizationService,
{
    let event = state
        .service
        .copy_shared_event(
            user.authorization.user.macro_user_id.as_ref(),
            event_id,
            request.calendar_id,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(event)))
}

/// How a sharer answers a request to join their event.
#[derive(Clone, Copy, Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarJoinRequestDecision {
    /// Add the requester as a guest, which sends them the invitation.
    Accept,
    /// Turn the request down. The requester is not told.
    Decline,
}

/// Request body answering a join request.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RespondToJoinRequestRequest {
    /// The sharer's answer.
    pub decision: CalendarJoinRequestDecision,
}

/// Answer a request to join an event the requester can change and return
/// where it now stands. Accepting adds the guest through the invite path; an
/// already answered request is returned unchanged.
#[tracing::instrument(skip_all, fields(request_id = %request_id), err)]
#[utoipa::path(
    put,
    path = "/join-requests/{request_id}",
    tag = "calendar_events",
    params(("request_id" = Uuid, Path, description = "Join request id")),
    request_body = RespondToJoinRequestRequest,
    responses(
        (status = 200, description = "The answered join request", body = CalendarJoinRequest),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Calendar is read-only, the organizer doesn't let guests invite others, or the calendar needs reauthorization", body = CalendarMutationApiError),
        (status = 404, description = "Request not found or its event cannot be changed by the requester", body = CalendarMutationApiError),
        (status = 409, description = "The provider rejected the new guest", body = CalendarMutationApiError),
        (status = 503, description = "Transient provider failure", body = CalendarMutationApiError),
    )
)]
pub async fn respond_to_join_request<S, L, Auth>(
    State(state): State<CalendarMutationRouterState<S, L, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(request_id): Path<Uuid>,
    Json(request): Json<RespondToJoinRequestRequest>,
) -> Result<Json<CalendarJoinRequest>, CalendarMutationApiError>
where
    S: CalendarMutationService,
    L: MeetingLinkProvider,
    Auth: MacroAuthorizationService,
{
    let answered = state
        .service
        .respond_to_join_request(
            user.authorization.user.macro_user_id.as_ref(),
            request_id,
            matches!(request.decision, CalendarJoinRequestDecision::Accept),
        )
        .await?;
    Ok(Json(answered))
}
