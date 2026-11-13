//! `/anthropic/v1/*`: the Anthropic Messages API for agent sessions on Macro credits.
//!
//! A runtime (Claude Code on a Macro computer) points `ANTHROPIC_BASE_URL` here
//! and sends its session's egress token as `ANTHROPIC_AUTH_TOKEN`. The request
//! is forwarded unchanged with Macro's key; the response streams back
//! unchanged while its `usage` is read and recorded against the session owner.
//! Only sessions whose bot runs on a Macro computer are served.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use agent_egress::domain::model::SessionToken;
use agent_session::domain::{
    credentials::authenticate_session, model::AgentSession, ports::AgentSessionRepo,
};
use ai_billing::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, post},
};
use axum_extra::headers::{Authorization, HeaderMapExt, authorization::Bearer};
use bot_id::BotId;
use computer_id::ComputerId;
use futures::StreamExt;
use tracing::{Instrument, Span, field::Empty};

use usage::{SseUsage, TokenUsage};

pub(crate) mod brain;
mod usage;

#[cfg(test)]
mod test;

/// Where requests go in deployed environments.
pub(super) const ANTHROPIC_API_URL: &str = "https://api.anthropic.com";

/// The gateway's closed model allowlist, for session requests.
#[derive(Clone, Copy)]
enum GatewayModel {
    Opus48,
    Sonnet46,
    Opus55,
    Sonnet5,
    Haiku45,
    Fable51,
}

const ALLOWED_MODELS: &[GatewayModel] = &[
    GatewayModel::Opus48,
    GatewayModel::Sonnet46,
    GatewayModel::Opus55,
    GatewayModel::Sonnet5,
    GatewayModel::Haiku45,
    GatewayModel::Fable51,
];

impl GatewayModel {
    fn parse(requested: &str) -> Result<Self, Rejection> {
        ALLOWED_MODELS
            .iter()
            .copied()
            .find(|model| model.request_id() == requested)
            .ok_or_else(|| Rejection::model_not_allowed(requested))
    }

    fn request_id(self) -> &'static str {
        match self {
            Self::Opus48 => "claude-opus-4-8",
            Self::Sonnet46 => "claude-sonnet-4-6",
            Self::Opus55 => "claude-opus-5-5",
            Self::Sonnet5 => "claude-sonnet-5",
            Self::Haiku45 => "claude-haiku-4-5-20251001",
            Self::Fable51 => "claude-fable-5-1",
        }
    }

    fn pricing_id(self) -> &'static str {
        match self {
            Self::Haiku45 => "claude-haiku-4-5",
            _ => self.request_id(),
        }
    }
}

/// Anthropic's own request size limit for the Messages API.
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;
/// Upper bound on a buffered non-streaming response.
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a stream is still read, for its usage, after the caller hangs up.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Chunks buffered between Anthropic and a slow caller.
const STREAM_BUFFER_CHUNKS: usize = 16;

/// Caller headers forwarded upstream. Everything else, including the
/// caller's credentials, is dropped.
const FORWARDED_REQUEST_HEADERS: &[&str] = &["anthropic-version", "anthropic-beta"];
/// Upstream headers returned to the caller.
const RETURNED_RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "cache-control",
    "request-id",
    "retry-after",
    "x-should-retry",
];

const MESSAGES_PATH: &str = "/v1/messages";
const COUNT_TOKENS_PATH: &str = "/v1/messages/count_tokens";

/// Which Macro computer serves a bot right now, if any.
pub(super) trait BotComputers: Send + Sync + 'static {
    fn computer_for(
        &self,
        bot: BotId,
    ) -> impl Future<Output = sqlx::Result<Option<ComputerId>>> + Send;
}

impl BotComputers for harnesses::outbound::pg_harness_repo::PgHarnessRepo {
    async fn computer_for(&self, bot: BotId) -> sqlx::Result<Option<ComputerId>> {
        self.computer_for_bot(bot).await
    }
}

/// Everything the gateway routes share.
pub(super) struct GatewayState<Sessions, Computers> {
    sessions: Arc<Sessions>,
    computers: Computers,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
    client: reqwest::Client,
    upstream_url: String,
    /// `None` when the service has no Anthropic key; every request is refused.
    api_key: Option<HeaderValue>,
    /// Agent teammates' brains; `None` refuses every `/brain/anthropic` call.
    brains: Option<Arc<dyn brain::BrainAuthenticator>>,
    /// Whether agent teammates are on for the calling agent.
    brain_rollout: brain::BrainRollout,
}

impl<Sessions, Computers> GatewayState<Sessions, Computers> {
    pub(super) fn new(
        sessions: Arc<Sessions>,
        computers: Computers,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
        upstream_url: &str,
        api_key: &str,
    ) -> anyhow::Result<Self> {
        let api_key = match api_key.trim() {
            "" => None,
            key => {
                let mut value = HeaderValue::from_str(key)?;
                value.set_sensitive(true);
                Some(value)
            }
        };
        Ok(Self {
            sessions,
            computers,
            admission,
            recorder,
            client: reqwest::Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .build()?,
            upstream_url: upstream_url.trim_end_matches('/').to_owned(),
            api_key,
            brains: None,
            brain_rollout: brain::BrainRollout::default(),
        })
    }

    /// Serve agent teammates' brains under `/brain/anthropic`, to agents with
    /// `enable-agent-teammates` on.
    pub(super) fn with_brains(
        mut self,
        brains: Arc<dyn brain::BrainAuthenticator>,
        rollout: brain::BrainRollout,
    ) -> Self {
        self.brains = Some(brains);
        self.brain_rollout = rollout;
        self
    }
}

/// Marks a request that came in under `/brain/anthropic`.
#[derive(Clone, Copy)]
struct BrainRoute;

/// The gateway's routes, mounted at the listener root.
pub(super) fn router<Sessions: AgentSessionRepo, Computers: BotComputers>(
    state: GatewayState<Sessions, Computers>,
) -> Router {
    Router::new()
        .route(
            "/anthropic/v1/messages",
            post(messages::<Sessions, Computers>),
        )
        .route(
            "/anthropic/v1/messages/count_tokens",
            post(count_tokens::<Sessions, Computers>),
        )
        .route("/anthropic/{*rest}", any(unsupported))
        .merge(
            Router::new()
                .route(
                    "/brain/anthropic/v1/messages",
                    post(messages::<Sessions, Computers>),
                )
                .route(
                    "/brain/anthropic/v1/messages/count_tokens",
                    post(count_tokens::<Sessions, Computers>),
                )
                .route("/brain/anthropic/{*rest}", any(unsupported))
                .layer(axum::Extension(BrainRoute)),
        )
        .with_state(Arc::new(state))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Endpoint {
    Messages,
    CountTokens,
}

impl Endpoint {
    fn path(self) -> &'static str {
        match self {
            Self::Messages => MESSAGES_PATH,
            Self::CountTokens => COUNT_TOKENS_PATH,
        }
    }
}

async fn messages<Sessions: AgentSessionRepo, Computers: BotComputers>(
    State(state): State<Arc<GatewayState<Sessions, Computers>>>,
    request: Request,
) -> Response {
    let span = tracing::info_span!(
        "anthropic_gateway.messages",
        agent.session.id = Empty,
        agent.bot.id = Empty,
        agent.harness = Empty,
        agent.user.id = Empty,
        agent.team.id = Empty,
        agent.computer.id = Empty,
        gen_ai.request.model = Empty,
        anthropic_gateway.stream = Empty,
        anthropic_gateway.outcome = Empty,
        anthropic_gateway.admission = Empty,
        http.response.status_code = Empty,
        gen_ai.usage.input_tokens = Empty,
        gen_ai.usage.output_tokens = Empty,
        anthropic_gateway.cache_read_tokens = Empty,
        anthropic_gateway.cache_write_tokens = Empty,
        otel.status_code = Empty,
    );
    respond(state, request, Endpoint::Messages, span).await
}

async fn count_tokens<Sessions: AgentSessionRepo, Computers: BotComputers>(
    State(state): State<Arc<GatewayState<Sessions, Computers>>>,
    request: Request,
) -> Response {
    let span = tracing::info_span!(
        "anthropic_gateway.count_tokens",
        agent.session.id = Empty,
        agent.bot.id = Empty,
        agent.harness = Empty,
        agent.user.id = Empty,
        agent.team.id = Empty,
        agent.computer.id = Empty,
        gen_ai.request.model = Empty,
        anthropic_gateway.outcome = Empty,
        anthropic_gateway.admission = Empty,
        http.response.status_code = Empty,
        otel.status_code = Empty,
    );
    respond(state, request, Endpoint::CountTokens, span).await
}

async fn unsupported() -> Response {
    Rejection {
        status: StatusCode::NOT_FOUND,
        kind: "not_found_error",
        outcome: "unsupported_endpoint",
        message: "Macro's Anthropic gateway serves only /v1/messages and /v1/messages/count_tokens"
            .into(),
    }
    .into_response()
}

async fn respond<Sessions: AgentSessionRepo, Computers: BotComputers>(
    state: Arc<GatewayState<Sessions, Computers>>,
    request: Request,
    endpoint: Endpoint,
    span: Span,
) -> Response {
    match forward(&state, request, endpoint, &span)
        .instrument(span.clone())
        .await
    {
        Ok(response) => response,
        Err(rejection) => {
            span.record("anthropic_gateway.outcome", rejection.outcome);
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

/// The fields of a request body the gateway decides on.
#[derive(serde::Deserialize)]
struct RequestShape {
    model: String,
}

async fn forward<Sessions: AgentSessionRepo, Computers: BotComputers>(
    state: &GatewayState<Sessions, Computers>,
    request: Request,
    endpoint: Endpoint,
    span: &Span,
) -> Result<Response, Rejection> {
    let (parts, body) = request.into_parts();
    let (owner, entity) = if parts.extensions.get::<BrainRoute>().is_some() {
        let brain = authenticate_brain(state.brains.as_deref(), &parts.headers).await?;
        span.record(
            "agent.user.id",
            agent_credentials::telemetry_id(brain.user_id.as_ref()),
        );
        span.record("agent.team.id", tracing::field::display(brain.team_id));
        if !state.brain_rollout.enabled(&brain.user_id).await {
            return Err(Rejection::AGENT_TEAMMATES_OFF);
        }
        (brain.user_id, None)
    } else {
        let session = authenticate(state.sessions.as_ref(), &parts.headers).await?;
        span.record("agent.session.id", tracing::field::display(session.id));
        span.record("agent.bot.id", tracing::field::display(session.bot_id));
        span.record("agent.harness", session.harness.as_str());
        let owner = session
            .owner_user()
            .map_err(|_| Rejection::permission("this session's owner cannot spend Macro credits"))?
            .clone();
        // The computer is the gate: the rollout limits selling computers, not
        // using them, so a teammate outside it, or anyone once it is off, still
        // runs Claude on a team computer.
        let computer = state
            .computers
            .computer_for(session.bot_id)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "session computer lookup failed"))
            .map_err(|_| Rejection::NOT_ON_A_COMPUTER)?
            .ok_or(Rejection::NOT_ON_A_COMPUTER)?;
        span.record("agent.computer.id", tracing::field::display(computer));
        (owner, Some(session.id.as_uuid()))
    };

    let body = to_bytes(body, MAX_REQUEST_BYTES)
        .await
        .map_err(|_| Rejection::invalid_request("request body is unreadable or too large"))?;
    let shape: RequestShape = serde_json::from_slice(&body).map_err(|_| {
        Rejection::invalid_request("request body must be a JSON object with a `model`")
    })?;
    let model = GatewayModel::parse(&shape.model)?;
    span.record("gen_ai.request.model", model.request_id());

    let api_key = state.api_key.as_ref().ok_or(Rejection::NOT_CONFIGURED)?;
    if endpoint == Endpoint::Messages {
        state
            .admission
            .admit(&owner, AiFeature::AgentSession)
            .await
            .map_err(|error| {
                span.record("anthropic_gateway.admission", "denied");
                Rejection::from_admission(error)
            })?;
        span.record("anthropic_gateway.admission", "accepted");
    }

    let upstream = state
        .client
        .post(format!("{}{}", state.upstream_url, endpoint.path()))
        .headers(upstream_headers(&parts.headers, api_key))
        .body(body)
        .send()
        .await
        .inspect_err(|error| tracing::warn!(error = ?error, "anthropic request failed"))
        .map_err(|_| Rejection::UPSTREAM_UNREACHABLE)?;

    let status = upstream.status();
    span.record("http.response.status_code", i64::from(status.as_u16()));
    if status.is_success() {
        span.record("anthropic_gateway.outcome", "forwarded");
    } else {
        span.record("anthropic_gateway.outcome", "upstream_error");
        if status.is_server_error() {
            span.record("otel.status_code", "ERROR");
        }
    }

    let headers = returned_headers(upstream.headers());
    let streaming = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"));

    let meter = (endpoint == Endpoint::Messages).then(|| UsageMeter {
        recorder: state.recorder.clone(),
        context: UsageContext::new(AiFeature::AgentSession, owner).with_entity(entity),
        model: model.pricing_id(),
        usage: TokenUsage::default(),
        span: span.clone(),
    });
    if endpoint == Endpoint::Messages {
        span.record("anthropic_gateway.stream", streaming);
    }

    let body = if streaming {
        let (caller, chunks) = tokio::sync::mpsc::channel(STREAM_BUFFER_CHUNKS);
        let metering = meter.map(|meter| (meter, SseUsage::default()));
        tokio::spawn(
            pump(Box::pin(upstream.bytes_stream()), metering, caller).instrument(span.clone()),
        );
        Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(chunks))
    } else {
        let bytes = read_limited(upstream).await?;
        if let Some(mut meter) = meter
            && let Some(usage) = usage::from_json_body(&bytes)
        {
            meter.usage = usage;
        }
        Body::from(bytes)
    };

    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}

async fn authenticate_brain(
    brains: Option<&dyn brain::BrainAuthenticator>,
    headers: &HeaderMap,
) -> Result<brain::BrainCaller, Rejection> {
    let brains = brains.ok_or(Rejection::NOT_CONFIGURED)?;
    let bearer = headers
        .typed_get::<Authorization<Bearer>>()
        .ok_or(Rejection::BRAIN_UNAUTHENTICATED)?;
    brains
        .authenticate(bearer.token())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "could not authenticate a brain");
            Rejection::UPSTREAM_UNREACHABLE
        })?
        .ok_or(Rejection::BRAIN_UNAUTHENTICATED)
}

type UpstreamChunks =
    Pin<Box<dyn futures::Stream<Item = reqwest::Result<axum::body::Bytes>> + Send>>;

/// Streams `upstream` to the caller while metering it. When the caller hangs
/// up, keeps reading (for at most [`DRAIN_TIMEOUT`]) so the final usage is
/// still recorded: an abort must not skip output billing.
async fn pump(
    mut upstream: UpstreamChunks,
    mut metering: Option<(UsageMeter, SseUsage)>,
    caller: tokio::sync::mpsc::Sender<Result<axum::body::Bytes, std::io::Error>>,
) {
    while let Some(chunk) = upstream.next().await {
        observe(&mut metering, &chunk);
        if caller
            .send(chunk.map_err(std::io::Error::other))
            .await
            .is_err()
        {
            let drain = async {
                while let Some(chunk) = upstream.next().await {
                    observe(&mut metering, &chunk);
                }
            };
            if tokio::time::timeout(DRAIN_TIMEOUT, drain).await.is_err() {
                tracing::warn!("anthropic stream outlived its drain after the caller hung up");
            }
            return;
        }
    }
}

fn observe(
    metering: &mut Option<(UsageMeter, SseUsage)>,
    chunk: &reqwest::Result<axum::body::Bytes>,
) {
    let Some((meter, parser)) = metering.as_mut() else {
        return;
    };
    match chunk {
        Ok(bytes) => {
            parser.observe(bytes);
            meter.usage = parser.usage();
        }
        Err(error) => {
            tracing::warn!(parent: &meter.span, error = ?error, "anthropic stream broke");
            meter
                .span
                .record("anthropic_gateway.outcome", "stream_error");
            meter.span.record("otel.status_code", "ERROR");
        }
    }
}

async fn authenticate<Sessions: AgentSessionRepo>(
    sessions: &Sessions,
    headers: &HeaderMap,
) -> Result<AgentSession, Rejection> {
    let bearer = headers
        .typed_get::<Authorization<Bearer>>()
        .ok_or(Rejection::UNAUTHENTICATED)?;
    authenticate_session(sessions, &SessionToken::new(bearer.token()).hash())
        .await
        .map_err(|_| Rejection::UNAUTHENTICATED)
}

fn upstream_headers(caller: &HeaderMap, api_key: &HeaderValue) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for name in FORWARDED_REQUEST_HEADERS {
        for value in caller.get_all(*name) {
            headers.append(HeaderName::from_static(name), value.clone());
        }
    }
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(HeaderName::from_static("x-api-key"), api_key.clone());
    headers
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

async fn read_limited(upstream: reqwest::Response) -> Result<axum::body::Bytes, Rejection> {
    let mut body = Vec::new();
    let mut chunks = upstream.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk
            .inspect_err(|error| tracing::warn!(error = ?error, "anthropic response broke"))
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
    model: &'static str,
    usage: TokenUsage,
    /// Kept open until the response is finished.
    span: Span,
}

impl Drop for UsageMeter {
    fn drop(&mut self) {
        let usage = self.usage;
        self.span.record(
            "gen_ai.usage.input_tokens",
            i64::try_from(usage.input).unwrap_or(i64::MAX),
        );
        self.span.record(
            "gen_ai.usage.output_tokens",
            i64::try_from(usage.output).unwrap_or(i64::MAX),
        );
        self.span.record(
            "anthropic_gateway.cache_read_tokens",
            i64::try_from(usage.cache_read).unwrap_or(i64::MAX),
        );
        self.span.record(
            "anthropic_gateway.cache_write_tokens",
            i64::try_from(usage.cache_write).unwrap_or(i64::MAX),
        );
        if usage.is_empty() {
            return;
        }
        self.recorder.record(
            self.context
                .clone()
                .into_event(self.model.to_owned(), usage.amount()),
        );
    }
}

/// A refusal in the Anthropic error shape, so Anthropic clients surface it.
#[derive(Debug)]
struct Rejection {
    status: StatusCode,
    /// Anthropic's `error.type`.
    kind: &'static str,
    /// Low-cardinality span outcome.
    outcome: &'static str,
    message: std::borrow::Cow<'static, str>,
}

impl Rejection {
    const BRAIN_UNAUTHENTICATED: Self = Self {
        status: StatusCode::UNAUTHORIZED,
        kind: "authentication_error",
        outcome: "unauthenticated",
        message: std::borrow::Cow::Borrowed(
            "send the agent teammate's Macro API key as `Authorization: Bearer`",
        ),
    };

    const UNAUTHENTICATED: Self = Self {
        status: StatusCode::UNAUTHORIZED,
        kind: "authentication_error",
        outcome: "unauthenticated",
        message: std::borrow::Cow::Borrowed(
            "send the agent session's Macro token as `Authorization: Bearer`",
        ),
    };

    /// Fails closed: agent teammates are off for the calling agent, or its
    /// flags could not be read.
    const AGENT_TEAMMATES_OFF: Self = Self {
        status: StatusCode::FORBIDDEN,
        kind: "permission_error",
        outcome: "agent_teammates_off",
        message: std::borrow::Cow::Borrowed("agent teammates are not enabled for this agent"),
    };

    /// Fails closed: the session is not on a Macro computer, or its lookup
    /// failed.
    const NOT_ON_A_COMPUTER: Self = Self {
        status: StatusCode::FORBIDDEN,
        kind: "permission_error",
        outcome: "not_on_a_computer",
        message: std::borrow::Cow::Borrowed(
            "Macro's Anthropic gateway serves only sessions on a Macro computer",
        ),
    };

    const NOT_CONFIGURED: Self = Self {
        status: StatusCode::SERVICE_UNAVAILABLE,
        kind: "api_error",
        outcome: "not_configured",
        message: std::borrow::Cow::Borrowed("Macro's Anthropic gateway has no API key configured"),
    };

    const UPSTREAM_UNREACHABLE: Self = Self {
        status: StatusCode::SERVICE_UNAVAILABLE,
        kind: "api_error",
        outcome: "upstream_unreachable",
        message: std::borrow::Cow::Borrowed("Anthropic could not be reached"),
    };

    fn invalid_request(message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            kind: "invalid_request_error",
            outcome: "invalid_request",
            message: message.into(),
        }
    }

    fn model_not_allowed(model: &str) -> Self {
        let allowed: Vec<&str> = ALLOWED_MODELS
            .iter()
            .map(|model| model.request_id())
            .collect();
        Self {
            status: StatusCode::BAD_REQUEST,
            kind: "invalid_request_error",
            outcome: "model_not_allowed",
            message: format!(
                "model `{model}` is not available on Macro credits; use one of: {}",
                allowed.join(", ")
            )
            .into(),
        }
    }

    fn permission(message: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            kind: "permission_error",
            outcome: "forbidden",
            message: message.into(),
        }
    }

    fn from_admission(error: AiAdmissionError) -> Self {
        match error {
            AiAdmissionError::Denied(_) => Self {
                status: StatusCode::FORBIDDEN,
                kind: "permission_error",
                outcome: "admission_denied",
                message: error.to_string().into(),
            },
            AiAdmissionError::Unavailable => Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                kind: "api_error",
                outcome: "admission_unavailable",
                message: error.to_string().into(),
            },
        }
    }
}

impl IntoResponse for Rejection {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "type": "error",
                "error": { "type": self.kind, "message": self.message },
            })),
        )
            .into_response()
    }
}
