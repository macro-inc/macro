//! Meeting-link adapter that asks the call service for a Macro call.
//!
//! Booking runs in the calendar service, which does not host calls. This
//! client creates the meeting through document storage on behalf of the
//! organizer and builds the same join URL the calendar UI recognizes.

use std::time::Duration;

use calendar_events::domain::{
    meeting_links::{MeetingLink, MeetingLinkError, MeetingLinkRequest},
    ports::MeetingLinkProvider,
};
use uuid::Uuid;

/// Header carrying the shared key for internal service authorization.
const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";
/// Header carrying the acting Macro user for internal authorization.
const INTERNAL_MACRO_USER_ID_HEADER: &str = "x-internal-macro-user-id";
/// Router path of meeting management, relative to the document storage origin.
const MEETINGS_PATH: &str = "/call/meetings";
/// Router path of the meeting setup page, relative to the app origin.
const MEETING_JOIN_PATH: &str = "/app/meet/join/";
/// Longest meeting title the call service accepts.
const MAX_MEETING_TITLE_CHARS: usize = 200;

/// [`MeetingLinkProvider`] that calls the document storage meeting routes.
pub struct HttpMeetingLinks {
    document_storage_url: String,
    app_origin: String,
    internal_api_key: String,
    http: reqwest::Client,
}

impl HttpMeetingLinks {
    /// `document_storage_url` is the document storage origin, including a
    /// gateway prefix such as `/dss`. `app_origin` is the browser origin
    /// join links are built on, for example `https://macro.com`.
    pub fn new(
        document_storage_url: impl Into<String>,
        app_origin: impl Into<String>,
        internal_api_key: impl Into<String>,
    ) -> Self {
        Self {
            document_storage_url: document_storage_url
                .into()
                .trim_end_matches('/')
                .to_string(),
            app_origin: app_origin.into().trim_end_matches('/').to_string(),
            internal_api_key: internal_api_key.into(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
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
            .request(method, format!("{}{path}", self.document_storage_url))
            .header(INTERNAL_API_KEY_HEADER, &self.internal_api_key)
            .header(INTERNAL_MACRO_USER_ID_HEADER, requester_id)
    }
}

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

fn join_url(app_origin: &str, share_token: &str) -> Result<String, MeetingLinkError> {
    if share_token.len() != 64 || !share_token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(MeetingLinkError::Failed(
            "meeting service returned an unusable join token".to_string(),
        ));
    }
    Ok(format!("{app_origin}{MEETING_JOIN_PATH}{share_token}"))
}

fn failure(status: reqwest::StatusCode, body: String) -> MeetingLinkError {
    let body: String = body.chars().take(200).collect();
    if status == reqwest::StatusCode::BAD_REQUEST {
        MeetingLinkError::InvalidInput(body)
    } else {
        MeetingLinkError::Failed(format!("meeting service returned {status}: {body}"))
    }
}

impl MeetingLinkProvider for HttpMeetingLinks {
    #[tracing::instrument(skip_all, err)]
    async fn create_meeting_link(
        &self,
        requester_id: &str,
        request: MeetingLinkRequest,
    ) -> Result<MeetingLink, MeetingLinkError> {
        let response = self
            .request(reqwest::Method::POST, MEETINGS_PATH, requester_id)
            .json(&serde_json::json!({
                "preparationId": null,
                "title": meeting_title(&request.title),
                "scheduledStart": request.scheduled_start,
                "scheduledEnd": request.scheduled_end,
            }))
            .send()
            .await
            .map_err(|error| {
                MeetingLinkError::Failed(format!("meeting service was unreachable: {error}"))
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(failure(status, body));
        }
        let created: CreatedMeeting = response.json().await.map_err(|error| {
            MeetingLinkError::Failed(format!(
                "meeting service returned an unreadable meeting: {error}"
            ))
        })?;
        Ok(MeetingLink {
            id: created.id,
            url: join_url(&self.app_origin, &created.share_token)?,
        })
    }

    #[tracing::instrument(skip_all, err, fields(meeting_id = %meeting_id))]
    async fn cancel_meeting_link(
        &self,
        requester_id: &str,
        meeting_id: Uuid,
    ) -> Result<(), MeetingLinkError> {
        let response = self
            .request(
                reqwest::Method::DELETE,
                &format!("{MEETINGS_PATH}/{meeting_id}"),
                requester_id,
            )
            .send()
            .await
            .map_err(|error| {
                MeetingLinkError::Failed(format!("meeting service was unreachable: {error}"))
            })?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.text().await.unwrap_or_default();
        Err(failure(status, body))
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatedMeeting {
    id: Uuid,
    share_token: String,
}

#[cfg(test)]
mod test;
