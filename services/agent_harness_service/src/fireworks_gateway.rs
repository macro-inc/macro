//! `/brain/fireworks/v1/chat/completions`: Kimi K3 on Fireworks for agent
//! teammates' CAPTCHA runs, on Macro's key.
//!
//! The agent's OpenCode run points its OpenAI-compatible provider here with
//! the agent's own Macro API key. The gateway authenticates and admits the
//! agent, pins the model and the output cap, forwards the request with
//! `FIREWORK_API_KEY`, and streams the response back while its `usage` is
//! read and recorded against the agent.

use std::sync::Arc;
use std::time::Duration;

use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, post},
};
use futures::StreamExt;
use serde_json::{Map, Value};
use tracing::{Instrument, Span, field::Empty};

use crate::anthropic_gateway::{brain::BrainAccess, pump};
use usage::{Observed, SseUsage};

mod usage;

#[cfg(test)]
mod test;

/// Fireworks' inference API root.
pub(crate) const FIREWORKS_API_URL: &str = "https://api.fireworks.ai/inference";
const CHAT_COMPLETIONS_PATH: &str = "/v1/chat/completions";

/// The one model served, by its wire id, and its `ai_pricing` row.
const KIMI_K3: &str = "accounts/fireworks/models/kimi-k3";
const KIMI_K3_PRICING: &str = "kimi-k3";
/// Output cap a request may ask for, and the one it gets when it asks for none.
const MAX_OUTPUT_TOKENS: u64 = 8192;
const DEFAULT_OUTPUT_TOKENS: u64 = 4096;
/// The two names OpenAI-compatible clients send the output cap under.
const OUTPUT_TOKEN_FIELDS: [&str; 2] = ["max_tokens", "max_completion_tokens"];

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Chunks buffered between Fireworks and a slow caller.
const STREAM_BUFFER_CHUNKS: usize = 16;
/// Upstream headers returned to the caller.
const RETURNED_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "cache-control",
    "retry-after",
    "x-request-id",
];

/// The Fireworks route's state.
pub(crate) struct FireworksGateway {
    access: BrainAccess,
    recorder: Arc<dyn UsageRecorder>,
    client: reqwest::Client,
    upstream_url: String,
    api_key: HeaderValue,
}

impl FireworksGateway {
    pub(crate) fn new(
        access: BrainAccess,
        recorder: Arc<dyn UsageRecorder>,
        upstream_url: &str,
        api_key: &str,
    ) -> anyhow::Result<Self> {
        let mut api_key = HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))?;
        api_key.set_sensitive(true);
        Ok(Self {
            access,
            recorder,
            client: reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .build()?,
            upstream_url: upstream_url.trim_end_matches('/').to_owned(),
            api_key,
        })
    }
}

/// The Fireworks routes, merged into the egress gateway router.
pub(crate) fn router(gateway: FireworksGateway) -> Router {
    Router::new()
        .route("/brain/fireworks/v1/chat/completions", post(chat))
        .route("/brain/fireworks/{*rest}", any(unsupported))
        .with_state(Arc::new(gateway))
}

async fn unsupported() -> Response {
    Rejection {
        status: StatusCode::NOT_FOUND,
        kind: "not_found_error",
        outcome: "unsupported_endpoint",
        message: "Macro's Fireworks gateway serves only /v1/chat/completions".into(),
    }
    .into_response()
}

async fn chat(
    State(gateway): State<Arc<FireworksGateway>>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let span = tracing::info_span!(
        "brain_fireworks.chat",
        agent.user.id = Empty,
        agent.team.id = Empty,
        gen_ai.request.model = Empty,
        gen_ai.response.id = Empty,
        brain_fireworks.stream = Empty,
        brain_fireworks.outcome = Empty,
        http.response.status_code = Empty,
        gen_ai.usage.input_tokens = Empty,
        gen_ai.usage.output_tokens = Empty,
        brain_fireworks.cache_read_tokens = Empty,
        otel.status_code = Empty,
    );
    match forward(&gateway, &headers, body, &span)
        .instrument(span.clone())
        .await
    {
        Ok(response) => response,
        Err(rejection) => {
            span.record("brain_fireworks.outcome", rejection.outcome);
            span.record(
                "http.response.status_code",
                i64::from(rejection.status.as_u16()),
            );
            if rejection.status.is_server_error() {
                span.record("otel.status_code", "ERROR");
            }
            rejection.into_response()
        }
    }
}

async fn forward(
    gateway: &FireworksGateway,
    headers: &HeaderMap,
    body: Body,
    span: &Span,
) -> Result<Response, Rejection> {
    let brain = gateway
        .access
        .authorize(headers)
        .await
        .map_err(Rejection::refused)?;
    span.record(
        "agent.user.id",
        agent_credentials::telemetry_id(brain.user_id.as_ref()),
    );
    span.record("agent.team.id", tracing::field::display(brain.team_id));

    let body = axum::body::to_bytes(body, MAX_REQUEST_BYTES)
        .await
        .map_err(|_| Rejection::invalid_request("request body is unreadable or too large"))?;
    let (body, streaming) = pinned_request(&body)?;
    span.record("gen_ai.request.model", KIMI_K3);
    span.record("brain_fireworks.stream", streaming);

    let mut upstream_headers = HeaderMap::new();
    upstream_headers.insert(header::AUTHORIZATION, gateway.api_key.clone());
    upstream_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    macro_tower_layers::inject_trace_headers(&mut upstream_headers);
    let upstream = gateway
        .client
        .post(format!("{}{CHAT_COMPLETIONS_PATH}", gateway.upstream_url))
        .headers(upstream_headers)
        .body(body)
        .send()
        .await
        .inspect_err(|error| tracing::warn!(error = ?error, "fireworks request failed"))
        .map_err(|_| Rejection::UPSTREAM_UNREACHABLE)?;

    let status = upstream.status();
    span.record("http.response.status_code", i64::from(status.as_u16()));
    if status.is_success() {
        span.record("brain_fireworks.outcome", "forwarded");
    } else {
        span.record("brain_fireworks.outcome", "upstream_error");
        if status.is_server_error() {
            span.record("otel.status_code", "ERROR");
        }
    }

    let returned = returned_headers(upstream.headers());
    let event_stream = returned
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"));
    let mut meter = UsageMeter {
        recorder: gateway.recorder.clone(),
        context: UsageContext::new(AiFeature::AgentSession, brain.user_id),
        observed: Observed::default(),
        span: span.clone(),
    };

    let body = if event_stream {
        let (caller, chunks) = tokio::sync::mpsc::channel(STREAM_BUFFER_CHUNKS);
        let mut parser = SseUsage::default();
        tokio::spawn(
            pump(
                Box::pin(upstream.bytes_stream()),
                move |chunk| match chunk {
                    Ok(bytes) => {
                        parser.observe(bytes);
                        meter.observed = parser.observed().clone();
                    }
                    Err(error) => {
                        tracing::warn!(parent: &meter.span, error = ?error, "fireworks stream broke");
                        meter.span.record("brain_fireworks.outcome", "stream_error");
                        meter.span.record("otel.status_code", "ERROR");
                    }
                },
                caller,
            )
            .instrument(span.clone()),
        );
        Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(chunks))
    } else {
        let bytes = read_limited(upstream).await?;
        meter.observed = usage::from_json_body(&bytes);
        drop(meter);
        Body::from(bytes)
    };

    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = returned;
    Ok(response)
}

/// The request as forwarded: Kimi K3 only, the output cap at most
/// [`MAX_OUTPUT_TOKENS`] (or [`DEFAULT_OUTPUT_TOKENS`] when unset), and a
/// stream asked to end with its usage. Returns whether it streams.
fn pinned_request(body: &[u8]) -> Result<(Vec<u8>, bool), Rejection> {
    let mut request: Map<String, Value> = serde_json::from_slice(body)
        .map_err(|_| Rejection::invalid_request("request body must be a JSON object"))?;
    match request.get("model").and_then(Value::as_str) {
        Some(KIMI_K3) => {}
        _ => return Err(Rejection::model_not_allowed()),
    }

    let mut capped = false;
    for field in OUTPUT_TOKEN_FIELDS {
        let Some(value) = request.get_mut(field) else {
            continue;
        };
        let asked = value.as_u64().ok_or(Rejection::invalid_request(
            "the output cap must be a whole number",
        ))?;
        *value = Value::from(asked.min(MAX_OUTPUT_TOKENS));
        capped = true;
    }
    if !capped {
        request.insert("max_tokens".to_owned(), Value::from(DEFAULT_OUTPUT_TOKENS));
    }

    let streaming = request.get("stream").and_then(Value::as_bool) == Some(true);
    if streaming {
        let options = request
            .entry("stream_options")
            .or_insert_with(|| Value::Object(Map::new()));
        let Value::Object(options) = options else {
            return Err(Rejection::invalid_request(
                "stream_options must be an object",
            ));
        };
        options.insert("include_usage".to_owned(), Value::Bool(true));
    }

    let body = serde_json::to_vec(&request)
        .map_err(|_| Rejection::invalid_request("request body must be a JSON object"))?;
    Ok((body, streaming))
}

fn returned_headers(upstream: &HeaderMap) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for name in RETURNED_RESPONSE_HEADERS {
        if let Some(value) = upstream.get(*name) {
            headers.insert(HeaderName::from_static(name), value.clone());
        }
    }
    headers
}

async fn read_limited(upstream: reqwest::Response) -> Result<Bytes, Rejection> {
    let mut body = Vec::new();
    let mut chunks = upstream.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk
            .inspect_err(|error| tracing::warn!(error = ?error, "fireworks response broke"))
            .map_err(|_| Rejection::UPSTREAM_UNREACHABLE)?;
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(Rejection::UPSTREAM_UNREACHABLE);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body.into())
}

/// Records a response's usage once it is finished: when a stream ends or its
/// caller goes away, or when a buffered body has been read.
struct UsageMeter {
    recorder: Arc<dyn UsageRecorder>,
    context: UsageContext,
    observed: Observed,
    /// Kept open until the response is finished.
    span: Span,
}

impl Drop for UsageMeter {
    fn drop(&mut self) {
        let usage = self.observed.usage;
        if let Some(id) = &self.observed.id {
            self.span.record("gen_ai.response.id", id.as_str());
        }
        self.span.record(
            "gen_ai.usage.input_tokens",
            i64::try_from(usage.input).unwrap_or(i64::MAX),
        );
        self.span.record(
            "gen_ai.usage.output_tokens",
            i64::try_from(usage.output).unwrap_or(i64::MAX),
        );
        self.span.record(
            "brain_fireworks.cache_read_tokens",
            i64::try_from(usage.cache_read).unwrap_or(i64::MAX),
        );
        if usage.is_empty() {
            return;
        }
        self.recorder.record(
            self.context
                .clone()
                .into_event(KIMI_K3_PRICING.to_owned(), usage.amount()),
        );
    }
}

/// A refusal in the OpenAI error shape, so OpenAI-compatible clients surface it.
#[derive(Debug)]
struct Rejection {
    status: StatusCode,
    /// OpenAI's `error.type`.
    kind: &'static str,
    /// Low-cardinality span outcome.
    outcome: &'static str,
    message: std::borrow::Cow<'static, str>,
}

impl Rejection {
    const UPSTREAM_UNREACHABLE: Self = Self {
        status: StatusCode::SERVICE_UNAVAILABLE,
        kind: "api_error",
        outcome: "upstream_unreachable",
        message: std::borrow::Cow::Borrowed("Fireworks could not be reached"),
    };

    /// The brain check's refusal: 401, 403 or 503.
    fn refused(status: StatusCode) -> Self {
        let (kind, outcome, message) = match status {
            StatusCode::UNAUTHORIZED => (
                "authentication_error",
                "unauthenticated",
                "send the agent teammate's Macro API key as `Authorization: Bearer`",
            ),
            StatusCode::FORBIDDEN => (
                "permission_error",
                "forbidden",
                "this agent may not spend Macro credits on Fireworks",
            ),
            _ => (
                "api_error",
                "unavailable",
                "the agent could not be checked; try again",
            ),
        };
        Self {
            status,
            kind,
            outcome,
            message: message.into(),
        }
    }

    fn invalid_request(message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            kind: "invalid_request_error",
            outcome: "invalid_request",
            message: message.into(),
        }
    }

    fn model_not_allowed() -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            kind: "invalid_request_error",
            outcome: "model_not_allowed",
            message: format!("only `{KIMI_K3}` is available on Macro credits").into(),
        }
    }
}

impl IntoResponse for Rejection {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "error": { "type": self.kind, "message": self.message },
            })),
        )
            .into_response()
    }
}
