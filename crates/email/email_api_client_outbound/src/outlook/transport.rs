use std::time::{Duration, Instant, SystemTime};

use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tracing::Instrument;
use url::Url;

use super::{IMMUTABLE_ID_PREFERENCE, OutlookApiClientRepository, route};
use email_api_client_core::models::{AccessToken, EmailApiError, RateLimitOrigin, StreamToken};

#[cfg(test)]
mod test;

const GRAPH_REQUEST: &str = "outlook.graph_request";

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

/// How a request's span reads a 404 from Graph.
#[derive(Clone, Copy)]
enum NotFound {
    /// The resource should exist, so a 404 is a failed request.
    Failure,
    /// "There is none" is an expected answer, such as a contact without a
    /// photo, so a 404 is not a span error.
    Answer,
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
            .map_err(|_| invalid_response("Graph root cannot take path segments"))?
            .pop_if_empty()
            .extend(segments.iter().copied());
        Ok(url)
    }

    pub(super) fn continuation(&self, token: &StreamToken) -> Result<Url, EmailApiError> {
        let url =
            Url::parse(token.expose()).map_err(|_| invalid_response("nextLink is not a URL"))?;
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

    /// A GET for a resource that may not exist: `None` when Graph answers 404,
    /// which the request's span records as an answer, not an error.
    pub(super) async fn optional_request(
        &self,
        token: &AccessToken,
        url: Url,
    ) -> Result<Option<Response>, EmailApiError> {
        match self
            .send_graph_request(token, Method::GET, url, None, None, NotFound::Answer)
            .await
        {
            Ok(response) => Ok(Some(response)),
            Err(GraphFailure {
                error: EmailApiError::NotFound,
                ..
            }) => Ok(None),
            Err(failure) => Err(failure.error),
        }
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
        self.send_graph_request(
            token,
            method,
            url,
            body,
            expected_version,
            NotFound::Failure,
        )
        .await
    }

    async fn send_graph_request(
        &self,
        token: &AccessToken,
        method: Method,
        url: Url,
        body: Option<&Value>,
        expected_version: Option<&str>,
        not_found: NotFound,
    ) -> Result<Response, GraphFailure> {
        let path = url.path().to_owned();
        let refreshed = self
            .refreshed_token
            .lock()
            .map_err(|_| invalid_response("refreshed token lock is poisoned"))?
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
        match self
            .graph_attempt(request, &method, &path, false, not_found)
            .await
        {
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
                        .map_err(|_| invalid_response("refreshed token lock is poisoned"))? =
                        Some(fresh.clone());
                    // A 401 explicitly rejected this request. Every network,
                    // timeout, and non-401 response is returned without replay.
                    let mut headers = reqwest::header::HeaderMap::new();
                    let mut authorization = reqwest::header::HeaderValue::from_str(&format!(
                        "Bearer {}",
                        fresh.expose_secret()
                    ))
                    .map_err(|_| invalid_response("refreshed token is not a header value"))?;
                    authorization.set_sensitive(true);
                    headers.insert(reqwest::header::AUTHORIZATION, authorization);
                    self.graph_attempt(retry.headers(headers), &method, &path, true, not_found)
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
    async fn graph_attempt(
        &self,
        request: RequestBuilder,
        method: &Method,
        path: &str,
        reauthorized: bool,
        not_found: NotFound,
    ) -> Result<Response, GraphFailure> {
        let span = tracing::info_span!(
            "outlook.graph_request",
            otel.kind = "client",
            // Datadog names a client span that carries an HTTP method
            // `http.client.request`; this keeps the span findable by name.
            operation.name = GRAPH_REQUEST,
            http.request.method = %method,
            url.template = %route::url_template(self.root.path(), path),
            mailbox.link_id = self.mailbox.map(|mailbox| tracing::field::display(mailbox.link_id)),
            mailbox.sync_generation = self.mailbox.map(|mailbox| mailbox.sync_generation),
            reauthorized,
            http.response.status_code = tracing::field::Empty,
            graph.request_id = tracing::field::Empty,
            outlook.gate_wait_ms = tracing::field::Empty,
            outlook.throttle_origin = tracing::field::Empty,
            outlook.retry_after_seconds = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        let result = self
            .gated_graph_request(request)
            .instrument(span.clone())
            .await;
        record_attempt(&span, &result, not_found);
        result
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
            let mailbox = self
                .mailbox
                .ok_or_else(|| invalid_response("gated request has no mailbox"))?;
            let started = Instant::now();
            let permit = gate
                .acquire(mailbox)
                .instrument(tracing::info_span!(
                    "outlook.graph_admission",
                    mailbox.link_id = %mailbox.link_id
                ))
                .await;
            tracing::Span::current().record(
                "outlook.gate_wait_ms",
                i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
            );
            Some((mailbox, permit?))
        } else {
            None
        };
        email_api_client_core::request_count::record_sent();
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
        let request_id = response
            .headers()
            .get("request-id")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let span = tracing::Span::current();
        span.record("http.response.status_code", i64::from(status.as_u16()));
        span.record("graph.request_id", request_id.as_deref());
        if status.is_success() {
            return Ok(response);
        }
        let path = response.url().path().to_owned();
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
        if let Some(delay) = retry_after {
            span.record("outlook.retry_after_seconds", whole_seconds(delay));
        }
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
        read_json(self.request(token, Method::GET, url, None).await?).await
    }
}

/// Numbers are recorded as `i64`: OpenTelemetry receives unsigned span fields
/// as strings.
///
/// Record where a failed attempt was throttled and mark real failures as span
/// errors. A gate refusal sent nothing, so it is neither an error nor a WARN;
/// the sync unit that owns the request reports the deferral. A 404 the caller
/// expects is an answer, not a failure.
fn record_attempt(
    span: &tracing::Span,
    result: &Result<Response, GraphFailure>,
    not_found: NotFound,
) {
    let failure = match (result, not_found) {
        (Err(failure), NotFound::Failure) => failure,
        (Err(failure), NotFound::Answer) if !matches!(failure.error, EmailApiError::NotFound) => {
            failure
        }
        _ => {
            span.record("outlook.throttle_origin", "none");
            return;
        }
    };
    // A response's Retry-After was recorded when it arrived; a gate refusal
    // has no response, so its delay is recorded here.
    let origin = match &failure.error {
        EmailApiError::RateLimited {
            origin: RateLimitOrigin::Provider { .. },
            ..
        } => "graph",
        EmailApiError::RateLimited { retry_after, .. } => {
            if let Some(delay) = retry_after {
                span.record("outlook.retry_after_seconds", whole_seconds(*delay));
            }
            "gate"
        }
        _ => "none",
    };
    span.record("outlook.throttle_origin", origin);
    if origin == "gate" {
        tracing::debug!(parent: span, error = %failure.error, "Microsoft request gate deferred a Graph request");
    } else {
        span.record(
            "otel.status_description",
            tracing::field::display(&failure.error),
        );
    }
}

fn whole_seconds(delay: Duration) -> i64 {
    i64::try_from(delay.as_millis().div_ceil(1000)).unwrap_or(i64::MAX)
}

/// `what` names the field or shape that failed. It must never quote the
/// response, which can carry mail content.
pub(super) fn invalid_response(what: impl std::fmt::Display) -> EmailApiError {
    EmailApiError::Permanent {
        message: format!("invalid Microsoft Graph response: {what}"),
    }
}

/// Decodes a Graph JSON body. A failure names the JSON path it happened at
/// and, for a missing or duplicate field, the field; serde's own message is
/// dropped because it quotes the offending value.
pub(super) async fn read_json<T: DeserializeOwned>(response: Response) -> Result<T, EmailApiError> {
    let body = response
        .bytes()
        .await
        .map_err(|_| invalid_response("body was cut off"))?;
    decode(&body)
}

fn decode<T: DeserializeOwned>(body: &[u8]) -> Result<T, EmailApiError> {
    let mut deserializer = serde_json::Deserializer::from_slice(body);
    let value = serde_path_to_error::deserialize(&mut deserializer).map_err(|error| {
        let problem = match error.inner().classify() {
            serde_json::error::Category::Data => data_problem(&error.inner().to_string()),
            serde_json::error::Category::Eof => "truncated JSON".to_owned(),
            serde_json::error::Category::Syntax | serde_json::error::Category::Io => {
                "malformed JSON".to_owned()
            }
        };
        invalid_response(format_args!("{problem} at {}", error.path()))
    })?;
    deserializer
        .end()
        .map_err(|_| invalid_response("trailing data after JSON"))?;
    Ok(value)
}

/// Field names come from the wire types, so they are safe to report; any
/// other data error is summarized.
fn data_problem(message: &str) -> String {
    for kind in ["missing field `", "duplicate field `"] {
        if let Some((field, _)) = message
            .strip_prefix(kind)
            .and_then(|rest| rest.split_once('`'))
        {
            return format!("{kind}{field}`");
        }
    }
    "unexpected value".to_owned()
}
