//! The authenticated Web API client: one per session and workspace.

use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use reqwest::StatusCode;
use reqwest::header::{self, HeaderMap, HeaderValue};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use tracing::Instrument;
use tracing::field::Empty;
use url::Url;

use crate::credentials::SessionCredentials;
use crate::endpoints::{SlackEndpoints, SlackWorkspace};
use crate::error::{SlackError, SlackErrorCode};
use crate::method::SlackMethod;
use crate::pacing::Pacer;

/// Requests to Slack time out after this long.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// How often a 429 is retried after waiting out `Retry-After`.
const MAX_RATE_LIMIT_RETRIES: u8 = 3;
/// `Retry-After` when Slack sends a 429 without one.
const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(30);
/// The web client's `Origin`.
pub(crate) const WEB_CLIENT_ORIGIN: &str = "https://app.slack.com";

/// Form fields of one Web API call; the client adds the token.
pub(crate) type Form = Vec<(&'static str, String)>;

/// A typed client for one Slack session in one workspace. Cheap to clone.
#[derive(Clone)]
pub struct SlackClient {
    inner: Arc<ClientInner>,
}

struct ClientInner {
    http: reqwest::Client,
    credentials: SessionCredentials,
    workspace: SlackWorkspace,
    endpoints: SlackEndpoints,
    pacer: Pacer,
}

/// The body of a call whose only result is `ok: true`.
#[derive(Deserialize)]
pub(crate) struct Acknowledged {}

#[derive(Deserialize)]
struct Envelope {
    ok: bool,
    error: Option<SlackErrorCode>,
}

impl SlackClient {
    /// Builds a client for `credentials` in `workspace`.
    pub fn new(
        credentials: SessionCredentials,
        workspace: SlackWorkspace,
        endpoints: SlackEndpoints,
    ) -> Result<Self, SlackError> {
        let http = build_http_client(&endpoints, SlackMethod::AuthTest)?;
        Ok(Self {
            inner: Arc::new(ClientInner {
                http,
                credentials,
                workspace,
                endpoints,
                pacer: Pacer::default(),
            }),
        })
    }

    /// The workspace this client talks to.
    pub fn workspace(&self) -> &SlackWorkspace {
        &self.inner.workspace
    }

    /// The endpoints this client talks to.
    pub fn endpoints(&self) -> &SlackEndpoints {
        &self.inner.endpoints
    }

    /// The session's credentials.
    pub fn credentials(&self) -> &SessionCredentials {
        &self.inner.credentials
    }

    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.inner.http
    }

    /// Calls a Web API method on the workspace host with a form body.
    pub(crate) async fn call<Response: DeserializeOwned>(
        &self,
        method: SlackMethod,
        form: Form,
    ) -> Result<Response, SlackError> {
        let url = self
            .inner
            .workspace
            .api_base()
            .and_then(|base| base.join(method.as_str()))
            .map_err(|error| invalid_request(method, error))?;
        self.send_paced(method, || {
            let mut fields = form.clone();
            fields.push(("token", self.inner.credentials.token.expose().to_owned()));
            self.inner
                .http
                .post(url.clone())
                .query(&web_client_query(&self.inner.workspace))
                .headers(self.cookie_headers())
                .form(&fields)
        })
        .await
    }

    /// Calls the edge API's cache (`cache/<team>/<path>`) with a JSON body.
    pub(crate) async fn call_edge<Response: DeserializeOwned>(
        &self,
        method: SlackMethod,
        path: &str,
        mut body: serde_json::Map<String, serde_json::Value>,
    ) -> Result<Response, SlackError> {
        let url = self
            .inner
            .endpoints
            .edge_api
            .join(&format!("cache/{}/{path}", self.inner.workspace.team_id))
            .map_err(|error| invalid_request(method, error))?;
        body.insert(
            "token".to_owned(),
            serde_json::Value::String(self.inner.credentials.token.expose().to_owned()),
        );
        let body = serde_json::to_vec(&body).map_err(|source| SlackError::Decode { method, source })?;
        self.send_paced(method, || {
            self.inner
                .http
                .post(url.clone())
                .headers(self.cookie_headers())
                .header(header::CONTENT_TYPE, "text/plain;charset=UTF-8")
                .body(body.clone())
        })
        .await
    }

    /// The `Cookie`, `Origin` and `User-Agent` headers the web client sends.
    pub(crate) fn cookie_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        let cookie = self.inner.credentials.cookie_header();
        if let Ok(mut value) = HeaderValue::from_str(cookie.expose()) {
            value.set_sensitive(true);
            headers.insert(header::COOKIE, value);
        }
        headers.insert(header::ORIGIN, HeaderValue::from_static(WEB_CLIENT_ORIGIN));
        headers
    }

    /// Sends one request, pacing it by the method's tier and waiting out
    /// `Retry-After` on 429s. Records one `slack.api` span.
    async fn send_paced<Response: DeserializeOwned>(
        &self,
        method: SlackMethod,
        build: impl Fn() -> reqwest::RequestBuilder,
    ) -> Result<Response, SlackError> {
        let span = tracing::info_span!(
            "slack.api",
            slack.method = method.as_str(),
            slack.team_id = %self.inner.workspace.team_id,
            http.response.status_code = Empty,
            slack.retry_count = Empty,
            slack.error = Empty,
            otel.status_code = Empty,
        );
        let pacer = &self.inner.pacer;
        async move {
            let mut retries: u8 = 0;
            let outcome = loop {
                tokio::time::sleep(pacer.reserve(method)).await;
                match send_once(method, build()).await {
                    Err(SlackError::RateLimited { retry_after, .. }) if retries < MAX_RATE_LIMIT_RETRIES => {
                        retries += 1;
                        pacer.hold(method, retry_after);
                    }
                    Err(SlackError::RateLimited { retry_after, .. }) => {
                        pacer.hold(method, retry_after);
                        break Err(SlackError::RateLimited { method, retry_after });
                    }
                    other => break other,
                }
            };
            record_outcome(&tracing::Span::current(), retries, &outcome);
            outcome.map(|(_, response)| response)
        }
        .instrument(span)
        .await
    }

    /// Downloads a file's `url_private` with the session's credentials.
    /// Refuses URLs off Slack's hosts so the token never leaves Slack.
    pub async fn download_file(&self, url: &Url) -> Result<DownloadedFile, SlackError> {
        let method = SlackMethod::FileDownload;
        if !self.is_slack_host(url) {
            return Err(SlackError::InvalidRequest {
                method,
                reason: "file URL is not on a Slack host".to_owned(),
            });
        }
        let span = tracing::info_span!(
            "slack.api",
            slack.method = method.as_str(),
            slack.team_id = %self.inner.workspace.team_id,
            http.response.status_code = Empty,
            slack.retry_count = 0,
            slack.error = Empty,
            otel.status_code = Empty,
            file.size = Empty,
        );
        let request = self
            .inner
            .http
            .get(url.clone())
            .headers(self.cookie_headers())
            .bearer_auth(self.inner.credentials.token.expose());
        async move {
            let outcome = download(method, request).await;
            let span = tracing::Span::current();
            match &outcome {
                Ok(file) => {
                    span.record("http.response.status_code", 200);
                    span.record("file.size", file.body.len());
                }
                Err(error) => record_error(&span, error),
            }
            outcome
        }
        .instrument(span)
        .await
    }

    /// Whether `url` is Slack's (or the configured fake's), so it may carry
    /// the session's credentials.
    pub(crate) fn is_slack_host(&self, url: &Url) -> bool {
        let Some(host) = url.host_str() else {
            return false;
        };
        let configured = [
            &self.inner.workspace.url,
            &self.inner.endpoints.slack,
            &self.inner.endpoints.app,
            &self.inner.endpoints.edge_api,
        ];
        let is_configured = configured
            .iter()
            .any(|known| known.host_str() == Some(host) && known.port_or_known_default() == url.port_or_known_default());
        let is_slack = url.scheme() == "https"
            && (host == "slack.com"
                || host.ends_with(".slack.com")
                || host.ends_with(".slack-edge.com"));
        is_configured || is_slack
    }
}

/// A downloaded file.
#[derive(Debug, Clone)]
pub struct DownloadedFile {
    /// The `Content-Type` Slack served.
    pub content_type: Option<String>,
    /// The bytes.
    pub body: Bytes,
}

pub(crate) fn build_http_client(
    endpoints: &SlackEndpoints,
    method: SlackMethod,
) -> Result<reqwest::Client, SlackError> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(endpoints.user_agent.clone())
        .build()
        .map_err(|source| SlackError::Transport { method, source })
}

/// `_x_*` query parameters the web client adds; `slack_route` routes Grid
/// sessions to the workspace's shard.
fn web_client_query(workspace: &SlackWorkspace) -> [(&'static str, String); 2] {
    let now = chrono::Utc::now();
    let request_id = format!(
        "noversion-{}.{:03}",
        now.timestamp(),
        now.timestamp_subsec_millis()
    );
    [
        ("_x_id", request_id),
        ("slack_route", workspace.team_id.to_string()),
    ]
}

pub(crate) fn invalid_request(method: SlackMethod, error: impl std::fmt::Display) -> SlackError {
    SlackError::InvalidRequest {
        method,
        reason: error.to_string(),
    }
}

/// Sends one request and decodes Slack's envelope.
pub(crate) async fn send_once<Response: DeserializeOwned>(
    method: SlackMethod,
    request: reqwest::RequestBuilder,
) -> Result<(StatusCode, Response), SlackError> {
    let response = request
        .send()
        .await
        .map_err(|source| SlackError::Transport { method, source })?;
    let status = response.status();
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(SlackError::RateLimited {
            method,
            retry_after: retry_after(response.headers()),
        });
    }
    let body = response
        .bytes()
        .await
        .map_err(|source| SlackError::Transport { method, source })?;
    decode(method, status, &body).map(|response| (status, response))
}

/// Decodes a Slack JSON response: `ok: false` becomes [`SlackError::Api`].
pub(crate) fn decode<Response: DeserializeOwned>(
    method: SlackMethod,
    status: StatusCode,
    body: &[u8],
) -> Result<Response, SlackError> {
    let envelope = match serde_json::from_slice::<Envelope>(body) {
        Ok(envelope) => envelope,
        Err(_) if !status.is_success() => {
            return Err(SlackError::HttpStatus {
                method,
                status: status.as_u16(),
            });
        }
        Err(source) => return Err(SlackError::Decode { method, source }),
    };
    if !envelope.ok {
        let code = envelope
            .error
            .unwrap_or_else(|| SlackErrorCode::Other(format!("http_{}", status.as_u16())));
        return Err(SlackError::Api { method, code });
    }
    serde_json::from_slice(body).map_err(|source| SlackError::Decode { method, source })
}

fn retry_after(headers: &HeaderMap) -> Duration {
    headers
        .get(header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map_or(DEFAULT_RETRY_AFTER, Duration::from_secs)
}

async fn download(method: SlackMethod, request: reqwest::RequestBuilder) -> Result<DownloadedFile, SlackError> {
    let response = request
        .send()
        .await
        .map_err(|source| SlackError::Transport { method, source })?;
    let status = response.status();
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(SlackError::RateLimited {
            method,
            retry_after: retry_after(response.headers()),
        });
    }
    if !status.is_success() {
        return Err(SlackError::HttpStatus {
            method,
            status: status.as_u16(),
        });
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    // Slack answers an expired or unauthorized file link with its HTML
    // sign-in page and a 200.
    if content_type.as_deref().is_some_and(|value| value.starts_with("text/html")) {
        return Err(SlackError::Api {
            method,
            code: SlackErrorCode::InvalidAuth,
        });
    }
    let body = response
        .bytes()
        .await
        .map_err(|source| SlackError::Transport { method, source })?;
    Ok(DownloadedFile { content_type, body })
}

fn record_outcome<Response>(
    span: &tracing::Span,
    retries: u8,
    outcome: &Result<(StatusCode, Response), SlackError>,
) {
    span.record("slack.retry_count", retries);
    match outcome {
        Ok((status, _)) => {
            span.record("http.response.status_code", status.as_u16());
        }
        Err(error) => record_error(span, error),
    }
}

pub(crate) fn record_error(span: &tracing::Span, error: &SlackError) {
    span.record("otel.status_code", "ERROR");
    match error {
        SlackError::Api { code, .. } => {
            span.record("slack.error", code.as_str());
        }
        SlackError::RateLimited { .. } => {
            span.record("http.response.status_code", 429);
            span.record("slack.error", "ratelimited");
        }
        SlackError::HttpStatus { status, .. } => {
            span.record("http.response.status_code", status);
        }
        SlackError::Transport { .. } => {
            span.record("slack.error", "transport");
        }
        SlackError::Decode { .. } => {
            span.record("slack.error", "decode");
        }
        SlackError::InvalidRequest { .. } => {
            span.record("slack.error", "invalid_request");
        }
    }
}
