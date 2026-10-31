use std::time::{Duration, SystemTime};

use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tracing::Instrument;
use url::Url;

use super::{IMMUTABLE_ID_PREFERENCE, OutlookApiClientRepository};
use crate::domain::models::{AccessToken, EmailApiError, RateLimitOrigin, StreamToken};

/// A failed Graph request with the response details a caller may branch on.
pub(super) struct GraphFailure {
    pub(super) error: EmailApiError,
    pub(super) status: Option<StatusCode>,
    pub(super) code: Option<String>,
    pub(super) request_id: Option<String>,
}

impl std::fmt::Display for GraphFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(f)
    }
}

impl From<EmailApiError> for GraphFailure {
    fn from(error: EmailApiError) -> Self {
        Self {
            error,
            status: None,
            code: None,
            request_id: None,
        }
    }
}

impl OutlookApiClientRepository {
    pub(super) fn endpoint(&self, segments: &[&str]) -> Result<Url, EmailApiError> {
        let mut url = self.root.clone();
        url.path_segments_mut()
            .map_err(|_| invalid_response())?
            .pop_if_empty()
            .extend(segments.iter().copied());
        Ok(url)
    }

    pub(super) fn continuation(&self, token: &StreamToken) -> Result<Url, EmailApiError> {
        let url = Url::parse(token.expose()).map_err(|_| invalid_response())?;
        // Never send a bearer to a host or API root supplied by a provider cursor.
        // Redirects are disabled as well. Opaque query parameters remain unchanged.
        if url.origin() != self.root.origin()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || !url.path().starts_with(self.root.path())
        {
            return Err(EmailApiError::Permanent {
                message: "Microsoft Graph continuation is outside the configured API".into(),
            });
        }
        Ok(url)
    }

    pub(super) async fn request(
        &self,
        token: &AccessToken,
        method: Method,
        url: Url,
        body: Option<&Value>,
    ) -> Result<Response, EmailApiError> {
        self.conditional_request(token, method, url, body, None)
            .await
    }

    pub(super) async fn conditional_request(
        &self,
        token: &AccessToken,
        method: Method,
        url: Url,
        body: Option<&Value>,
        expected_version: Option<&str>,
    ) -> Result<Response, EmailApiError> {
        self.graph_request(token, method, url, body, expected_version)
            .await
            .map_err(|failure| failure.error)
    }

    /// Like `conditional_request`, for callers that branch on the Graph error code.
    pub(super) async fn graph_request(
        &self,
        token: &AccessToken,
        method: Method,
        url: Url,
        body: Option<&Value>,
        expected_version: Option<&str>,
    ) -> Result<Response, GraphFailure> {
        let path = url.path().to_owned();
        let refreshed = self
            .refreshed_token
            .lock()
            .map_err(|_| invalid_response())?
            .clone();
        let token = refreshed.as_ref().unwrap_or(token);
        let mut request = self
            .client
            .request(method.clone(), url)
            .bearer_auth(token.expose_secret())
            .header("Prefer", IMMUTABLE_ID_PREFERENCE);
        if let Some(version) = expected_version {
            request = request.header("If-Match", version);
        }
        match body {
            Some(body) => request = request.json(body),
            // reqwest omits Content-Length for an empty body, and Graph answers a
            // bodyless POST or PATCH without it with 411 Length Required.
            None if matches!(method, Method::POST | Method::PATCH) => {
                request = request.header("Content-Length", 0)
            }
            None => {}
        }
        let retry = self
            .rejected_token_refresh
            .as_ref()
            .and_then(|_| request.try_clone());
        match self.graph_attempt(request, &method, &path, false).await {
            Err(GraphFailure {
                error: EmailApiError::AuthRequired,
                ..
            }) => {
                if let (Some(refresh), Some(retry), Some(mailbox)) =
                    (&self.rejected_token_refresh, retry, self.mailbox)
                {
                    let fresh = refresh.refresh(mailbox).await?;
                    *self
                        .refreshed_token
                        .lock()
                        .map_err(|_| invalid_response())? = Some(fresh.clone());
                    // A 401 explicitly rejected this request. Every network,
                    // timeout, and non-401 response is returned without replay.
                    let mut headers = reqwest::header::HeaderMap::new();
                    let mut authorization = reqwest::header::HeaderValue::from_str(&format!(
                        "Bearer {}",
                        fresh.expose_secret()
                    ))
                    .map_err(|_| invalid_response())?;
                    authorization.set_sensitive(true);
                    headers.insert(reqwest::header::AUTHORIZATION, authorization);
                    self.graph_attempt(retry.headers(headers), &method, &path, true)
                        .await
                } else {
                    Err(EmailApiError::AuthRequired.into())
                }
            }
            result => result,
        }
    }

    /// One Graph round trip, including its wait for the mailbox gate. A replay
    /// with a refreshed token is its own attempt, so each keeps its status.
    #[tracing::instrument(
        name = "outlook.graph_request",
        skip_all,
        fields(
            otel.kind = "client",
            http.request.method = %method,
            url.path = path,
            link_id = self.mailbox.map(|mailbox| tracing::field::display(mailbox.link_id)),
            http.response.status_code = tracing::field::Empty,
            reauthorized = reauthorized,
        ),
        err(level = "warn")
    )]
    async fn graph_attempt(
        &self,
        request: RequestBuilder,
        method: &Method,
        path: &str,
        reauthorized: bool,
    ) -> Result<Response, GraphFailure> {
        self.gated_graph_request(request).await
    }

    /// Includes anonymous, preauthorized attachment uploads in mailbox accounting.
    pub(super) async fn gated_request(
        &self,
        request: RequestBuilder,
    ) -> Result<Response, EmailApiError> {
        self.gated_graph_request(request)
            .await
            .map_err(|failure| failure.error)
    }

    async fn gated_graph_request(&self, request: RequestBuilder) -> Result<Response, GraphFailure> {
        let permit = if let Some(gate) = &self.gate {
            let mailbox = self.mailbox.ok_or_else(invalid_response)?;
            let permit = gate
                .acquire(mailbox)
                .instrument(tracing::info_span!(
                    "outlook.graph_admission",
                    link_id = %mailbox.link_id
                ))
                .await?;
            Some((mailbox, permit))
        } else {
            None
        };
        let result = Self::send_request(request).await;
        if let (Some(gate), Some((mailbox, permit))) = (&self.gate, permit) {
            let retry_after = match &result {
                Err(GraphFailure {
                    error: EmailApiError::RateLimited { retry_after, .. },
                    ..
                }) => Some(retry_after.unwrap_or(Duration::from_secs(30))),
                _ => None,
            };
            gate.finish(mailbox, permit, retry_after).await;
        }
        result
    }

    async fn send_request(request: RequestBuilder) -> Result<Response, GraphFailure> {
        let transport_failed = |_| EmailApiError::Transient {
            message: "Microsoft Graph transport failed".into(),
        };
        let (client, request) = request.build_split();
        let request = request.map_err(transport_failed)?;
        let method = request.method().clone();
        let response = client.execute(request).await.map_err(transport_failed)?;
        let status = response.status();
        tracing::Span::current().record("http.response.status_code", status.as_u16());
        if status.is_success() {
            return Ok(response);
        }
        let path = response.url().path().to_owned();
        let request_id = response
            .headers()
            .get("request-id")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.parse::<u64>().ok().map(Duration::from_secs).or_else(|| {
                    httpdate::parse_http_date(v)
                        .ok()
                        .map(|date| date.duration_since(SystemTime::now()).unwrap_or_default())
                })
            });
        let body = response.text().await.unwrap_or_default();
        let error: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        let code = error.pointer("/error/code").and_then(Value::as_str);
        if method != Method::GET {
            // Graph error messages can quote recipient addresses. The code and
            // request-id identify the failure; only bodies without a Graph error
            // code, such as the front end's 411 page, are logged verbatim.
            tracing::warn!(
                %method,
                path,
                status = status.as_u16(),
                graph_error_code = code,
                graph_request_id = request_id.as_deref(),
                body = code.is_none().then_some(body.as_str()),
                "Microsoft Graph rejected a write"
            );
        }
        // Do not propagate provider messages, bodies, request URLs, or cursor tokens.
        let error = match status {
            StatusCode::UNAUTHORIZED => EmailApiError::AuthRequired,
            StatusCode::FORBIDDEN => EmailApiError::Forbidden,
            StatusCode::GONE => EmailApiError::OutdatedCursor,
            StatusCode::NOT_FOUND
                if matches!(
                    code,
                    Some("SyncStateNotFound" | "ErrorInvalidSyncStateData")
                ) =>
            {
                EmailApiError::OutdatedCursor
            }
            StatusCode::NOT_FOUND => EmailApiError::NotFound,
            StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED => EmailApiError::Conflict,
            StatusCode::TOO_MANY_REQUESTS => EmailApiError::RateLimited {
                retry_after,
                origin: RateLimitOrigin::Provider { concurrency: false },
            },
            status if status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT => {
                EmailApiError::Transient {
                    message: format!("Microsoft Graph returned HTTP {}", status.as_u16()),
                }
            }
            status => EmailApiError::Permanent {
                message: format!("Microsoft Graph returned HTTP {}", status.as_u16()),
            },
        };
        Err(GraphFailure {
            error,
            status: Some(status),
            code: code.map(str::to_owned),
            request_id,
        })
    }

    pub(super) async fn get<T: DeserializeOwned>(
        &self,
        token: &AccessToken,
        url: Url,
    ) -> Result<T, EmailApiError> {
        self.request(token, Method::GET, url, None)
            .await?
            .json()
            .await
            .map_err(|_| invalid_response())
    }
}

pub(super) fn invalid_response() -> EmailApiError {
    EmailApiError::Permanent {
        message: "invalid Microsoft Graph response".into(),
    }
}
