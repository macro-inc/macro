use reqwest::StatusCode;
use serde::Deserialize;
use tracing::Instrument;
use tracing::field::Empty;
use url::Url;

use crate::client::{Acknowledged, Form, SlackClient, build_http_client, invalid_request, record_error, send_once};
use crate::credentials::SessionCredentials;
use crate::endpoints::{SlackEndpoints, SlackWorkspace};
use crate::error::SlackError;
use crate::ids::{EnterpriseId, TeamId, UserId};
use crate::method::SlackMethod;

/// `auth.test`: who the session is.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct AuthTest {
    /// The workspace's web URL.
    pub url: Url,
    /// Workspace name.
    pub team: String,
    /// The user's handle.
    pub user: String,
    /// The workspace.
    pub team_id: TeamId,
    /// The user.
    pub user_id: UserId,
    /// The Grid org, if any.
    pub enterprise_id: Option<EnterpriseId>,
}

impl AuthTest {
    /// The workspace to build a [`SlackClient`] for.
    pub fn workspace(&self) -> SlackWorkspace {
        SlackWorkspace {
            team_id: self.team_id.clone(),
            url: self.url.clone(),
        }
    }
}

/// Checks a token and cookie before the workspace is known: `auth.test` on
/// `slack.com`, which answers with the workspace's URL and team id.
pub async fn validate_session(
    credentials: &SessionCredentials,
    endpoints: &SlackEndpoints,
) -> Result<AuthTest, SlackError> {
    let method = SlackMethod::AuthTest;
    let http = build_http_client(endpoints, method)?;
    let url = endpoints
        .slack
        .join("api/auth.test")
        .map_err(|error| invalid_request(method, error))?;
    let span = tracing::info_span!(
        "slack.api",
        slack.method = method.as_str(),
        slack.team_id = Empty,
        http.response.status_code = Empty,
        slack.retry_count = 0,
        slack.error = Empty,
        otel.status_code = Empty,
    );
    let mut cookie = reqwest::header::HeaderValue::from_str(credentials.cookie_header().expose())
        .map_err(|error| invalid_request(method, error))?;
    cookie.set_sensitive(true);
    let request = http
        .post(url)
        .header(reqwest::header::COOKIE, cookie)
        .header(reqwest::header::ORIGIN, crate::client::WEB_CLIENT_ORIGIN)
        .form(&[("token", credentials.token.expose())]);
    async move {
        let outcome = send_once::<AuthTest>(method, request).await;
        let span = tracing::Span::current();
        match &outcome {
            Ok((status, auth)) => {
                span.record("http.response.status_code", status.as_u16());
                span.record("slack.team_id", auth.team_id.as_str());
            }
            Err(error) => record_error(&span, error),
        }
        outcome.map(|(_, auth): (StatusCode, AuthTest)| auth)
    }
    .instrument(span)
    .await
}

impl SlackClient {
    /// `auth.test`: checks the session in this workspace.
    pub async fn auth_test(&self) -> Result<AuthTest, SlackError> {
        self.call(SlackMethod::AuthTest, Form::new()).await
    }

    /// `auth.signout`: ends the session at Slack. The token and cookie stop
    /// working afterwards.
    pub async fn sign_out(&self) -> Result<(), SlackError> {
        self.call::<Acknowledged>(SlackMethod::AuthSignout, Form::new())
            .await
            .map(|_| ())
    }
}
