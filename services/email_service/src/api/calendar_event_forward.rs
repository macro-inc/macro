//! Forward one of the viewer's calendar events by email, for a guest whose
//! organizer does not let them add guests.
#[cfg(test)]
mod test;

use super::context::{ApiContext, AuthorizationService};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use email::domain::{
    event_forward::{EventForwardError, EventForwardRequest, forward_event},
    models::ContactInfo,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Who a forwarded invitation goes to, and what its email says.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForwardCalendarEventRequest {
    /// The people it goes to, at most 50.
    pub to: Vec<ForwardCalendarEventRecipient>,
    /// A plain-text summary of the event the email opens with; the title
    /// when absent. The email ends with a note saying what the recipient
    /// can do with the forward.
    #[serde(default)]
    pub body_text: Option<String>,
}

/// One person a forwarded invitation goes to.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForwardCalendarEventRecipient {
    /// Their email address.
    pub email: String,
    /// Their display name.
    #[serde(default)]
    pub name: Option<String>,
}

/// The email the forward queued.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForwardCalendarEventResponse {
    /// The sent message.
    pub message_id: Uuid,
    /// Its thread.
    pub thread_id: Uuid,
}

/// Why a forward was not sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ForwardCalendarEventErrorCode {
    /// The event is unknown, cancelled, or not on one of the viewer's own
    /// inboxes.
    NotFound,
    /// The recipients are missing, too many, or not email addresses.
    InvalidRecipients,
    /// The inbox holding the viewer's copy cannot send email for them.
    InboxUnavailable,
    /// The email could not be sent; trying again may work.
    SendFailed,
}

/// A refused or failed forward.
#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ForwardCalendarEventError {
    /// What went wrong.
    pub code: ForwardCalendarEventErrorCode,
    /// A message fit to show the user.
    pub message: String,
}

impl IntoResponse for ForwardCalendarEventError {
    fn into_response(self) -> Response {
        let status = match self.code {
            ForwardCalendarEventErrorCode::NotFound => StatusCode::NOT_FOUND,
            ForwardCalendarEventErrorCode::InvalidRecipients => StatusCode::BAD_REQUEST,
            ForwardCalendarEventErrorCode::InboxUnavailable => StatusCode::FORBIDDEN,
            ForwardCalendarEventErrorCode::SendFailed => StatusCode::BAD_GATEWAY,
        };
        (status, Json(self)).into_response()
    }
}

impl From<EventForwardError> for ForwardCalendarEventError {
    fn from(error: EventForwardError) -> Self {
        let (code, message) = match &error {
            EventForwardError::NotFound => (
                ForwardCalendarEventErrorCode::NotFound,
                "Event not found".to_owned(),
            ),
            EventForwardError::InvalidRecipients(reason) => (
                ForwardCalendarEventErrorCode::InvalidRecipients,
                (*reason).to_owned(),
            ),
            EventForwardError::InboxUnavailable => (
                ForwardCalendarEventErrorCode::InboxUnavailable,
                error.to_string(),
            ),
            EventForwardError::Email(_) | EventForwardError::Internal(_) => {
                tracing::error!(error=?error, "calendar event forward failed");
                (
                    ForwardCalendarEventErrorCode::SendFailed,
                    "The invitation could not be forwarded".to_owned(),
                )
            }
        };
        Self { code, message }
    }
}

/// Email one of the viewer's events to people the organizer's guest list
/// does not name, from the inbox that holds the viewer's copy, with the
/// usual undo delay, carrying the copy's join link. When the copy is Google's
/// private copy of an invitation from an organizer outside Google, it is a
/// real invitation (`METHOD:REQUEST`) naming the recipients, who answer it to
/// the organizer, who gets the email too. Otherwise it is the event's file
/// (`METHOD:PUBLISH`, no attendees): recipients can add the event to their
/// own calendar, are not added to the guest list, and the organizer is not
/// told.
#[utoipa::path(post,
    path = "/email/calendar-events/{event_id}/forward",
    tag = "email",
    operation_id = "forward_calendar_event",
    params(("event_id" = Uuid, Path, description = "The viewer's copy of the event")),
    request_body = ForwardCalendarEventRequest,
    responses(
        (status = 202, description = "The email is queued to send", body = ForwardCalendarEventResponse),
        (status = 400, description = "No, too many, or invalid recipients", body = ForwardCalendarEventError),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "The inbox holding the copy cannot send for the viewer", body = ForwardCalendarEventError),
        (status = 404, description = "No such event on one of the viewer's own inboxes", body = ForwardCalendarEventError),
        (status = 502, description = "The email could not be sent", body = ForwardCalendarEventError),
    ))]
pub(crate) async fn handler(
    State(state): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(event_id): Path<Uuid>,
    Json(request): Json<ForwardCalendarEventRequest>,
) -> Result<(StatusCode, Json<ForwardCalendarEventResponse>), ForwardCalendarEventError> {
    let actor = authorization.authorization.user.macro_user_id.clone();
    let email = state.email_service.service();
    let sent = forward_event(
        state.calendar_service.as_ref(),
        email.as_ref(),
        state.event_forward_sender.as_ref(),
        actor,
        event_id,
        EventForwardRequest {
            to: request
                .to
                .into_iter()
                .map(|recipient| ContactInfo {
                    email: recipient.email,
                    name: recipient.name,
                    photo_url: None,
                })
                .collect(),
            body_text: request.body_text,
        },
    )
    .await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(ForwardCalendarEventResponse {
            message_id: sent.db_id,
            thread_id: sent.thread_db_id,
        }),
    ))
}
