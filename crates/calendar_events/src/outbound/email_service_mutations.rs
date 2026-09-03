//! Email-service HTTP adapter for the calendar mutation port.
//!
//! The email service is the calendar write authority: it holds the Google
//! provider client, token minting, and the per-inbox request gate. Hosts
//! that expose calendar mutations without those dependencies (the AI tool
//! hosts) implement [`CalendarMutationService`] through this client, so
//! every mutation flows through the same routes, validation, and error
//! mapping as user-initiated ones.

#[cfg(all(test, feature = "inbound"))]
mod test;

use reqwest::StatusCode;
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::{
    models::{
        AttendeeResponseStatus, CalendarEvent, CalendarEventDraft, CalendarEventPatch,
        VisibleCalendar,
    },
    ports::{
        CalendarDeletionScope, CalendarMutationError, CalendarMutationService, CalendarRsvpScope,
        CalendarUpdateScope,
    },
};

/// Header carrying the shared key for internal service authorization.
const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";
/// Header carrying the acting Macro user for internal authorization.
const INTERNAL_MACRO_USER_ID_HEADER: &str = "x-internal-macro-user-id";

/// Calendar mutation client calling the email service with internal
/// authorization on behalf of the requesting user.
pub struct EmailServiceCalendarMutations {
    base_url: String,
    internal_api_key: String,
    http: reqwest::Client,
}

impl EmailServiceCalendarMutations {
    /// Construct the client for the email service at `base_url`.
    pub fn new(base_url: String, internal_api_key: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            internal_api_key,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("static reqwest client configuration is valid"),
        }
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        requester_id: &str,
    ) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{path}", self.base_url))
            .header(INTERNAL_API_KEY_HEADER, &self.internal_api_key)
            .header(INTERNAL_MACRO_USER_ID_HEADER, requester_id)
    }

    async fn send(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, CalendarMutationError> {
        let response = request.send().await.map_err(|error| {
            CalendarMutationError::Retryable(format!(
                "calendar mutation request failed to reach the email service: {error}"
            ))
        })?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        Err(error_from_response(status, response.text().await.ok()))
    }

    async fn event_from(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.send(request)
            .await?
            .json::<CalendarEvent>()
            .await
            .map_err(|error| {
                CalendarMutationError::PersistFailed(format!(
                    "calendar mutation succeeded but its echo could not be parsed: {error}"
                ))
            })
    }
}

/// Wire body for the calendars listing.
#[derive(Deserialize)]
struct ListCalendarsWire {
    calendars: Vec<VisibleCalendar>,
}

/// Wire body of a mutation error response.
#[derive(Deserialize)]
struct MutationErrorWire {
    code: String,
    message: String,
}

/// Map an error response to the domain failure its code encodes.
fn error_from_response(status: StatusCode, body: Option<String>) -> CalendarMutationError {
    let parsed = body
        .as_deref()
        .and_then(|body| serde_json::from_str::<MutationErrorWire>(body).ok());
    let Some(error) = parsed else {
        return fallback_error(
            status,
            format!(
                "the email service calendar API returned status {status} with no mutation \
                 error body"
            ),
        );
    };
    match error.code.as_str() {
        "not_found" => CalendarMutationError::NotFound,
        "occurrence_not_found" => CalendarMutationError::OccurrenceNotFound,
        "read_only" => CalendarMutationError::ReadOnly,
        "no_writable_calendar" => CalendarMutationError::NoWritableCalendar,
        "not_attendee" => CalendarMutationError::NotAttendee,
        "invalid_input" => CalendarMutationError::InvalidInput(error.message),
        "reauth_required" => CalendarMutationError::ReauthRequired(error.message),
        "provider_rejected" => CalendarMutationError::ProviderRejected(error.message),
        "retryable" => CalendarMutationError::Retryable(error.message),
        "persist_failed" => CalendarMutationError::PersistFailed(error.message),
        _ => fallback_error(status, error.message),
    }
}

/// Classify an unrecognized failure by its status. Marking a client error
/// retryable would invite a duplicate non-idempotent write (a retried create
/// makes a second event and re-invites its attendees), so only statuses that
/// genuinely signal a transient condition stay [`CalendarMutationError::Retryable`].
fn fallback_error(status: StatusCode, message: String) -> CalendarMutationError {
    match status {
        StatusCode::NOT_FOUND => CalendarMutationError::NotFound,
        StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_MANY_REQUESTS => {
            CalendarMutationError::Retryable(message)
        }
        _ if status.is_client_error() => CalendarMutationError::InvalidInput(message),
        _ => CalendarMutationError::Retryable(message),
    }
}

/// Wire body for event creation, matching `CreateCalendarEventRequest`.
fn create_body(
    email_link_id: Option<Uuid>,
    calendar_id: Option<Uuid>,
    draft: &CalendarEventDraft,
) -> serde_json::Value {
    serde_json::json!({
        "emailLinkId": email_link_id,
        "calendarId": calendar_id,
        "title": draft.title,
        "description": draft.description,
        "location": draft.location,
        "time": draft.time,
        "attendees": attendees_body(&draft.attendees),
        "recurrenceLines": draft.recurrence_lines,
        "visibility": draft.visibility,
        "transparency": draft.transparency,
        "reminders": draft.reminders,
        "conference": draft.conference,
        "outOfOffice": draft.out_of_office,
    })
}

/// Wire body for an event patch, matching `UpdateCalendarEventRequest`.
fn update_body(patch: &CalendarEventPatch, scope: &CalendarUpdateScope) -> serde_json::Value {
    let (scope_name, recurrence_id) = match scope {
        CalendarUpdateScope::All => ("all", None),
        CalendarUpdateScope::ThisEvent { recurrence_id } => {
            ("this_event", Some(recurrence_id.as_str()))
        }
    };
    serde_json::json!({
        "title": patch.title,
        "description": patch.description,
        "location": patch.location,
        "time": patch.time,
        "attendees": patch
            .attendees
            .as_deref()
            .map(attendees_body),
        "recurrenceLines": patch.recurrence_lines,
        "visibility": patch.visibility,
        "transparency": patch.transparency,
        "reminders": patch.reminders,
        "conference": patch.conference,
        "outOfOffice": patch.out_of_office,
        "scope": scope_name,
        "recurrenceId": recurrence_id,
    })
}

fn attendees_body(
    attendees: &[crate::domain::models::CalendarAttendeeInput],
) -> Vec<serde_json::Value> {
    attendees
        .iter()
        .map(|attendee| {
            serde_json::json!({
                "email": attendee.email,
                "isOptional": attendee.is_optional,
            })
        })
        .collect()
}

/// Wire query for a deletion scope, matching `DeleteCalendarEventQuery`.
fn delete_query(scope: &CalendarDeletionScope) -> Vec<(&'static str, String)> {
    match scope {
        CalendarDeletionScope::All => vec![("scope", "all".to_string())],
        CalendarDeletionScope::ThisEvent { recurrence_id } => vec![
            ("scope", "this_event".to_string()),
            ("recurrenceId", recurrence_id.clone()),
        ],
        CalendarDeletionScope::ThisAndFollowing { recurrence_id } => vec![
            ("scope", "this_and_following".to_string()),
            ("recurrenceId", recurrence_id.clone()),
        ],
    }
}

/// Wire body for an RSVP, matching `RsvpCalendarEventRequest`.
fn rsvp_body(response: AttendeeResponseStatus, scope: &CalendarRsvpScope) -> serde_json::Value {
    match scope {
        CalendarRsvpScope::All => serde_json::json!({
            "response": response,
            "scope": "all",
        }),
        CalendarRsvpScope::ThisEvent { recurrence_id } => serde_json::json!({
            "response": response,
            "scope": "this_event",
            "recurrenceId": recurrence_id,
        }),
    }
}

impl CalendarMutationService for EmailServiceCalendarMutations {
    #[tracing::instrument(skip(self, requester_id, draft), err)]
    async fn create_event(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.event_from(
            self.request(reqwest::Method::POST, "/calendar/events", requester_id)
                .json(&create_body(email_link_id, calendar_id, &draft)),
        )
        .await
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, CalendarMutationError> {
        self.send(self.request(reqwest::Method::GET, "/calendar/calendars", requester_id))
            .await?
            .json::<ListCalendarsWire>()
            .await
            .map(|wire| wire.calendars)
            .map_err(|error| {
                CalendarMutationError::Retryable(format!(
                    "the calendars listing could not be parsed: {error}"
                ))
            })
    }

    #[tracing::instrument(skip(self, requester_id, patch), err)]
    async fn update_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.event_from(
            self.request(
                reqwest::Method::PATCH,
                &format!("/calendar/events/{event_id}"),
                requester_id,
            )
            .json(&update_body(&patch, &scope)),
        )
        .await
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn delete_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        scope: CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        self.send(
            self.request(
                reqwest::Method::DELETE,
                &format!("/calendar/events/{event_id}"),
                requester_id,
            )
            .query(&delete_query(&scope)),
        )
        .await
        .map(|_| ())
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn respond_to_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        self.event_from(
            self.request(
                reqwest::Method::PUT,
                &format!("/calendar/events/{event_id}/rsvp"),
                requester_id,
            )
            .json(&rsvp_body(response, &scope)),
        )
        .await
    }

    #[tracing::instrument(skip(self, requester_id), err)]
    async fn disconnect_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> Result<(), CalendarMutationError> {
        self.send(self.request(
            reqwest::Method::DELETE,
            &format!("/email/links/{email_link_id}/calendar"),
            requester_id,
        ))
        .await
        .map(|_| ())
    }
}
