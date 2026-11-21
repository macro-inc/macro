//! `/brain/fireworks/v1/chat/completions`: Kimi K3 on Fireworks for agent
//! teammates' CAPTCHA runs, on Macro's key.
//!
//! The agent's OpenCode run points its OpenAI-compatible provider here with
//! the agent's own Macro API key and its solver run's id
//! (`x-macro-solver-run`). The gateway authenticates and admits the agent,
//! takes one model call from the run ([`crate::solver_runs`]), pins the
//! model and the output cap, forwards the request with `FIREWORK_API_KEY`,
//! and streams the response back while its `usage` is read and recorded
//! against the agent. Without a key every call is a 503 `not_configured`.

use std::sync::Arc;
use std::time::Duration;

use ai_usage::financial::{
    FinalizeInvocation, InvocationId, ProviderModel, ProviderOutcome, ProviderRequestId, RunId,
    TrustedTokenUsage, UnresolvedReason, UsageEvidence,
};
use ai_usage::{AiFeature, TrackedInvocation, UsageContext, UsageRecorder};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, post},
};
use chrono::Utc;
use futures::StreamExt;
use serde_json::{Map, Value};
use tracing::{Instrument, Span, field::Empty};

use crate::anthropic_gateway::{brain::BrainAccess, pump};
use crate::solver_runs::{self, RunRefusal, SolverRunId, SolverRuns};
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
/// The tracking journal's provider name.
const FIREWORKS_PROVIDER: &str = "fireworks";
/// Output cap a request may ask for, and the one it gets when it asks for
/// none: the guest's solver asks for 2048, and a script holding the relay
/// gets no more.
const MAX_OUTPUT_TOKENS: u64 = 2048;
const DEFAULT_OUTPUT_TOKENS: u64 = 2048;
/// The two names OpenAI-compatible clients send the output cap under.
const OUTPUT_TOKEN_FIELDS: [&str; 2] = ["max_tokens", "max_completion_tokens"];

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// The whole upstream call, stream included: a CAPTCHA run's model turn is
/// at most 2048 tokens, and the run itself ends after five minutes.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5 * 60);
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
    runs: Arc<dyn SolverRuns>,
    client: reqwest::Client,
    upstream_url: String,
    /// `None` when no key is configured.
    api_key: Option<HeaderValue>,
    /// Where stream pumps and slot releases run; shutdown waits for it.
    tasks: tokio_util::task::TaskTracker,
}

impl FireworksGateway {
    /// `api_key` unset or empty: every call answers 503 `not_configured`.
    pub(crate) fn new(
        access: BrainAccess,
        recorder: Arc<dyn UsageRecorder>,
        runs: Arc<dyn SolverRuns>,
        upstream_url: &str,
        api_key: Option<&str>,
        tasks: tokio_util::task::TaskTracker,
    ) -> anyhow::Result<Self> {
        let api_key = match api_key.map(str::trim) {
            Some(key) if !key.is_empty() => {
                let mut value = HeaderValue::from_str(&format!("Bearer {key}"))?;
                value.set_sensitive(true);
                Some(value)
            }
            _ => None,
        };
        Ok(Self {
            access,
            recorder,
            runs,
            client: reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()?,
            upstream_url: upstream_url.trim_end_matches('/').to_owned(),
            api_key,
            tasks,
        })
    }
}

/// The Fireworks routes, merged into the egress gateway router.
pub(crate) fn router(gateway: FireworksGateway) -> Router {
    Router::new()
        .route("/brain/fireworks/v1/chat/completions", post(chat))
        .route("/brain/fireworks/{*rest}", any(unsupported))
        .with_state(Arc::new(gateway))
        // Adopts the caller's traceparent, so `brain_fireworks.chat` joins the run's trace.
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_millis(200))
                .into_inner(),
        )
}

async fn unsupported() -> Response {
    Rejection {
        status: StatusCode::NOT_FOUND,
        kind: "not_found_error",
        code: None,
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
        brain_fireworks.run_id = Empty,
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
    let api_key = gateway.api_key.clone().ok_or(Rejection::NOT_CONFIGURED)?;
    let run = solver_runs::run_header(headers).ok_or(Rejection::run(RunRefusal::Required))?;
    span.record("brain_fireworks.run_id", tracing::field::display(run.0));

    let body = axum::body::to_bytes(body, MAX_REQUEST_BYTES)
        .await
        .map_err(|_| Rejection::invalid_request("request body is unreadable or too large"))?;
    let (body, streaming) = pinned_request(&body)?;
    span.record("gen_ai.request.model", KIMI_K3);
    span.record("brain_fireworks.stream", streaming);

    gateway
        .runs
        .take_model_call(run, &brain.user_id)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "the solver run could not be read");
            Rejection::RUNS_UNAVAILABLE
        })?
        .map_err(Rejection::run)?;
    // From here the call holds one of the run's in-flight slots, which the
    // meter gives back when the response is finished.
    let mut meter = UsageMeter {
        recorder: gateway.recorder.clone(),
        context: UsageContext::new(AiFeature::AgentSession, brain.user_id.clone()),
        tracked: None,
        runs: gateway.runs.clone(),
        tasks: gateway.tasks.clone(),
        run,
        status: None,
        broken: false,
        observed: Observed::default(),
        span: span.clone(),
    };
    meter.tracked = track_begin(&gateway.recorder, run, &brain.user_id).await;

    let mut upstream_headers = HeaderMap::new();
    upstream_headers.insert(header::AUTHORIZATION, api_key);
    upstream_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    // No traceparent: our trace ids don't go to a vendor.
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
    meter.status = Some(status);
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

    let body = if event_stream {
        let (caller, chunks) = tokio::sync::mpsc::channel(STREAM_BUFFER_CHUNKS);
        let mut parser = SseUsage::default();
        gateway.tasks.spawn(
            pump(
                Box::pin(upstream.bytes_stream()),
                move |chunk| match chunk {
                    Ok(bytes) => {
                        parser.observe(bytes);
                        meter.observed = parser.observed().clone();
                    }
                    Err(error) => {
                        tracing::warn!(parent: &meter.span, error = ?error, "fireworks stream broke");
                        meter.broken = true;
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
        let bytes = match read_limited(upstream).await {
            Ok(bytes) => bytes,
            Err(rejection) => {
                meter.broken = true;
                return Err(rejection);
            }
        };
        meter.observed = usage::from_json_body(&bytes);
        drop(meter);
        Body::from(bytes)
    };

    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = returned;
    Ok(response)
}

/// Record the call's start in the tracking journal under its solver run,
/// when the recorder has one.
async fn track_begin(
    recorder: &Arc<dyn UsageRecorder>,
    run: SolverRunId,
    agent: &macro_user_id::user_id::MacroUserIdStr<'static>,
) -> Option<(Arc<dyn ai_usage::UsageTracking>, TrackedInvocation)> {
    let tracking = recorder.tracking()?;
    let (Ok(run_id), Ok(model)) = (
        RunId::try_from(run.0),
        ProviderModel::new(FIREWORKS_PROVIDER, KIMI_K3),
    ) else {
        tracing::error!("the model call cannot be identified for tracking");
        return None;
    };
    let invocation = TrackedInvocation {
        run_id,
        invocation_id: InvocationId::new(),
        user: agent.clone(),
        feature: AiFeature::AgentSession,
        entity: None,
        model,
        occurred_at: Utc::now(),
    };
    let _ = tracking
        .begin(invocation.clone())
        .await
        .inspect_err(|error| {
            tracing::error!(error = ?error, "usage observation begin failed; the call continues");
        });
    Some((tracking, invocation))
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

    // One choice per call: `n` would multiply the output the caps bound.
    if let Some(choices) = request.get("n")
        && choices.as_u64() != Some(1)
    {
        return Err(Rejection::invalid_request("n must be 1"));
    }

    // A null cap is unset, as Fireworks reads it.
    request
        .retain(|field, value| !(OUTPUT_TOKEN_FIELDS.contains(&field.as_str()) && value.is_null()));
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
/// caller goes away, when a buffered body has been read, or when the call
/// failed. The legacy recorder bills the tokens; the tracking journal
/// observes the call with Fireworks' response id and bills nothing. Gives
/// back the run's in-flight slot.
struct UsageMeter {
    /// Where the slot's release runs, so shutdown waits for it.
    tasks: tokio_util::task::TaskTracker,
    recorder: Arc<dyn UsageRecorder>,
    context: UsageContext,
    tracked: Option<(Arc<dyn ai_usage::UsageTracking>, TrackedInvocation)>,
    runs: Arc<dyn SolverRuns>,
    run: SolverRunId,
    /// Fireworks' status, once it answered.
    status: Option<StatusCode>,
    /// The response broke off before its end.
    broken: bool,
    observed: Observed,
    /// Kept open until the response is finished.
    span: Span,
}

impl UsageMeter {
    fn evidence(&self, invocation_id: InvocationId) -> FinalizeInvocation {
        let usage = self.observed.usage;
        let outcome = match self.status {
            None => ProviderOutcome::Unknown,
            Some(_) if self.broken => ProviderOutcome::Unknown,
            Some(status) if status.is_success() => ProviderOutcome::Succeeded,
            Some(_) => ProviderOutcome::Failed,
        };
        let usage = if !usage.is_empty() {
            UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(
                usage.input,
                usage.output,
                usage.cache_read,
                0,
                0,
            ))
        } else if self.status.is_none() || self.broken {
            UsageEvidence::Missing(UnresolvedReason::Interrupted)
        } else {
            UsageEvidence::Missing(UnresolvedReason::UsageNotReported)
        };
        FinalizeInvocation {
            invocation_id,
            occurred_at: Utc::now(),
            provider_request_id: self
                .observed
                .id
                .as_deref()
                .and_then(|id| ProviderRequestId::new(id).ok()),
            outcome,
            usage,
        }
    }
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
        if !usage.is_empty() {
            self.recorder.record(
                self.context
                    .clone()
                    .into_event(KIMI_K3_PRICING.to_owned(), usage.amount()),
            );
        }

        let tracked = self.tracked.take().map(|(tracking, invocation)| {
            let evidence = self.evidence(invocation.invocation_id);
            (tracking, invocation, evidence)
        });
        let runs = Arc::clone(&self.runs);
        let run = self.run;
        self.tasks.spawn(
            async move {
                let _ = runs.release_model_call(run).await.inspect_err(|error| {
                    tracing::error!(error = ?error, "the model call's in-flight slot was not given back");
                });
                if let Some((tracking, invocation, evidence)) = tracked {
                    solver_runs::track(tracking, invocation, evidence).await;
                }
            }
            .instrument(self.span.clone()),
        );
    }
}

/// A refusal in the OpenAI error shape, so OpenAI-compatible clients surface it.
#[derive(Debug)]
struct Rejection {
    status: StatusCode,
    /// OpenAI's `error.type`.
    kind: &'static str,
    /// OpenAI's `error.code`, for a solver-run refusal.
    code: Option<&'static str>,
    /// Low-cardinality span outcome.
    outcome: &'static str,
    message: std::borrow::Cow<'static, str>,
}

impl Rejection {
    const UPSTREAM_UNREACHABLE: Self = Self {
        status: StatusCode::SERVICE_UNAVAILABLE,
        kind: "api_error",
        code: None,
        outcome: "upstream_unreachable",
        message: std::borrow::Cow::Borrowed("Fireworks could not be reached"),
    };

    const NOT_CONFIGURED: Self = Self {
        status: StatusCode::SERVICE_UNAVAILABLE,
        kind: "not_configured",
        code: None,
        outcome: "not_configured",
        message: std::borrow::Cow::Borrowed("Macro has no Fireworks key configured"),
    };

    const RUNS_UNAVAILABLE: Self = Self {
        status: StatusCode::SERVICE_UNAVAILABLE,
        kind: "api_error",
        code: None,
        outcome: "runs_unavailable",
        message: std::borrow::Cow::Borrowed("the solver run could not be checked; try again"),
    };

    /// A run the call may not spend: 403 or 429 with the refusal's `code`.
    fn run(refusal: RunRefusal) -> Self {
        let kind = match refusal {
            RunRefusal::Required | RunRefusal::Expired | RunRefusal::Ended => "permission_error",
            RunRefusal::Exhausted | RunRefusal::Busy => "rate_limit_error",
        };
        Self {
            status: refusal.status(),
            kind,
            code: Some(refusal.code()),
            outcome: "run_refused",
            message: refusal.message().into(),
        }
    }

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
            code: None,
            outcome,
            message: message.into(),
        }
    }

    fn invalid_request(message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            kind: "invalid_request_error",
            code: None,
            outcome: "invalid_request",
            message: message.into(),
        }
    }

    fn model_not_allowed() -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            kind: "invalid_request_error",
            code: None,
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
                "error": { "type": self.kind, "code": self.code, "message": self.message },
            })),
        )
            .into_response()
    }
}
