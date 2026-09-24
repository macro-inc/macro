//! Axum router for asking to join calendar events shared with a channel.
//!
//! Handlers parse transport data, forward the authenticated requester to the
//! domain join-request service, and map its errors to HTTP. Who may ask and
//! who may read requests is decided in the domain.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::Serialize;
use uuid::Uuid;

use crate::domain::{
    models::CalendarJoinRequest,
    ports::{CalendarJoinRequestError, CalendarJoinRequestService},
};

/// Router state for authenticated join requests.
pub struct CalendarJoinRequestRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for CalendarJoinRequestRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> CalendarJoinRequestRouterState<S, Auth> {
    /// Create router state from a shared join-request service and
    /// authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<CalendarJoinRequestRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CalendarJoinRequestRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the authenticated join-request router.
pub fn calendar_join_request_router<S, Auth, T>(
    state: CalendarJoinRequestRouterState<S, Auth>,
) -> Router<T>
where
    S: CalendarJoinRequestService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/calendar-events/{event_id}/join-requests",
            post(request_to_join::<S, Auth>).get(list_join_requests::<S, Auth>),
        )
        .with_state(state)
}

/// Machine-readable join-request failure category.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarJoinRequestErrorCode {
    /// The event does not exist or is not visible to the requester.
    NotFound,
    /// The meeting is already on one of the requester's calendars.
    AlreadyOnCalendar,
    /// Only the organizer can add guests to the event.
    OrganizerOnly,
    /// An internal failure.
    Internal,
}

/// HTTP error body returned by join-request endpoints.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CalendarJoinRequestApiError {
    /// Machine-readable failure category.
    pub code: CalendarJoinRequestErrorCode,
    /// Human-readable failure description.
    pub message: String,
    #[serde(skip)]
    status: StatusCode,
}

impl std::fmt::Display for CalendarJoinRequestApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl IntoResponse for CalendarJoinRequestApiError {
    fn into_response(self) -> Response {
        (self.status, Json(&self)).into_response()
    }
}

impl From<CalendarJoinRequestError> for CalendarJoinRequestApiError {
    fn from(error: CalendarJoinRequestError) -> Self {
        let (status, code, message) = match &error {
            CalendarJoinRequestError::NotFound => (
                StatusCode::NOT_FOUND,
                CalendarJoinRequestErrorCode::NotFound,
                "calendar event was not found",
            ),
            CalendarJoinRequestError::AlreadyOnCalendar => (
                StatusCode::CONFLICT,
                CalendarJoinRequestErrorCode::AlreadyOnCalendar,
                "this event is already on one of your calendars",
            ),
            CalendarJoinRequestError::OrganizerOnly => (
                StatusCode::CONFLICT,
                CalendarJoinRequestErrorCode::OrganizerOnly,
                "only the organizer can add guests to this event",
            ),
            CalendarJoinRequestError::Internal(report) => {
                tracing::error!(error=?report, "calendar join request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    CalendarJoinRequestErrorCode::Internal,
                    "calendar join request failed",
                )
            }
        };
        Self {
            code,
            message: message.to_string(),
            status,
        }
    }
}

/// Pending requests to join one event.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarJoinRequestsResponse {
    /// Oldest first.
    pub requests: Vec<CalendarJoinRequest>,
}

/// Ask the owner of an event shared with one of the requester's channels to
/// add them as a guest.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    post,
    path = "/calendar-events/{event_id}/join-requests",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Shared calendar event entity id")),
    responses(
        (status = 200, description = "The requester's join request", body = CalendarJoinRequest),
        (status = 401, description = "Authentication required"),
        (status = 404, description = "Event not found or not shared with the requester", body = CalendarJoinRequestApiError),
        (status = 409, description = "Already on the requester's calendar, or only the organizer can add guests", body = CalendarJoinRequestApiError),
        (status = 500, description = "Join request failed", body = CalendarJoinRequestApiError),
    )
)]
pub async fn request_to_join<S, Auth>(
    State(state): State<CalendarJoinRequestRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
) -> Result<Json<CalendarJoinRequest>, CalendarJoinRequestApiError>
where
    S: CalendarJoinRequestService,
    Auth: MacroAuthorizationService,
{
    let request = state
        .service
        .request_to_join(user.authorization.user.macro_user_id.as_ref(), event_id)
        .await?;
    Ok(Json(request))
}

/// List pending requests to join one of the requester's events.
#[tracing::instrument(skip_all, fields(event_id = %event_id), err)]
#[utoipa::path(
    get,
    path = "/calendar-events/{event_id}/join-requests",
    tag = "calendar_events",
    params(("event_id" = Uuid, Path, description = "Calendar event entity id")),
    responses(
        (status = 200, description = "Pending join requests, oldest first", body = CalendarJoinRequestsResponse),
        (status = 401, description = "Authentication required"),
        (status = 404, description = "Event not found or not editable by the requester", body = CalendarJoinRequestApiError),
        (status = 500, description = "Listing failed", body = CalendarJoinRequestApiError),
    )
)]
pub async fn list_join_requests<S, Auth>(
    State(state): State<CalendarJoinRequestRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(event_id): Path<Uuid>,
) -> Result<Json<CalendarJoinRequestsResponse>, CalendarJoinRequestApiError>
where
    S: CalendarJoinRequestService,
    Auth: MacroAuthorizationService,
{
    let requests = state
        .service
        .list_join_requests(user.authorization.user.macro_user_id.as_ref(), event_id)
        .await?;
    Ok(Json(CalendarJoinRequestsResponse { requests }))
}
