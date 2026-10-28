//! Meeting-link adapter over the call domain service.
//!
//! Mints standalone Macro meetings owned by the requester, the same ones the
//! calendar UI creates through `POST /call/meetings`, and renders the join
//! URL the frontend recognizes as a Macro call.

use std::sync::Arc;

use call::domain::meetings::{CreateMeetingRequest, MAX_MEETING_TITLE_CHARS};
use call::domain::models::CallError;
use call::domain::ports::CallService;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::meeting_links::{MeetingLink, MeetingLinkError, MeetingLinkRequest};
use crate::domain::ports::MeetingLinkProvider;

/// Router path of the meeting setup page, relative to the app origin.
const MEETING_JOIN_PATH: &str = "/app/meet/join/";

/// [`MeetingLinkProvider`] backed by the call domain service.
pub struct CallServiceMeetingLinks<S: CallService> {
    service: Arc<S>,
    app_origin: String,
}

impl<S: CallService> CallServiceMeetingLinks<S> {
    /// Wrap the call service. `app_origin` is the browser origin join links
    /// are built on, e.g. `https://macro.com`; a trailing slash is ignored.
    pub fn new(service: Arc<S>, app_origin: impl Into<String>) -> Self {
        Self {
            service,
            app_origin: app_origin.into().trim_end_matches('/').to_string(),
        }
    }
}

fn join_url(app_origin: &str, share_token: &str) -> String {
    format!("{app_origin}{MEETING_JOIN_PATH}{share_token}")
}

/// Fit an event title into the meeting provider's contract: no control
/// characters, at most [`MAX_MEETING_TITLE_CHARS`], and `None` when nothing
/// is left so the provider's default title applies.
fn meeting_title(title: &str) -> Option<String> {
    let title: String = title
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_MEETING_TITLE_CHARS)
        .collect();
    let title = title.trim().to_string();
    (!title.is_empty()).then_some(title)
}

fn requester<'a>(requester_id: &'a str) -> Result<MacroUserIdStr<'a>, MeetingLinkError> {
    MacroUserIdStr::parse_from_str(requester_id)
        .map_err(|error| MeetingLinkError::InvalidInput(format!("invalid requester id: {error}")))
}

fn map_call_error(error: CallError) -> MeetingLinkError {
    match error {
        CallError::InvalidRequest(message) => MeetingLinkError::InvalidInput(message),
        other => MeetingLinkError::Failed(other.to_string()),
    }
}

impl<S: CallService> MeetingLinkProvider for CallServiceMeetingLinks<S> {
    #[tracing::instrument(skip_all, err)]
    async fn create_meeting_link(
        &self,
        requester_id: &str,
        request: MeetingLinkRequest,
    ) -> Result<MeetingLink, MeetingLinkError> {
        let meeting = self
            .service
            .create_meeting(
                requester(requester_id)?,
                CreateMeetingRequest {
                    // No room is pre-reserved: a scheduled meeting allocates
                    // its room on first join, like one made from the calendar.
                    preparation_id: None,
                    title: meeting_title(&request.title),
                    scheduled_start: request.scheduled_start,
                    scheduled_end: request.scheduled_end,
                },
            )
            .await
            .map_err(map_call_error)?;
        Ok(MeetingLink {
            id: meeting.id,
            url: join_url(&self.app_origin, meeting.share_token.as_str()),
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn cancel_meeting_link(
        &self,
        requester_id: &str,
        meeting_id: Uuid,
    ) -> Result<(), MeetingLinkError> {
        self.service
            .cancel_meeting(requester(requester_id)?, &meeting_id)
            .await
            .map_err(map_call_error)
    }
}

#[cfg(test)]
mod test;
