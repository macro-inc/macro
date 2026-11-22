//! `POST /teammates/telemetry`: a self-hosted macrod's lifecycle spans
//! (OTLP/HTTP protobuf traces), authenticated with its harness credential and
//! forwarded to this service's own OTLP export.
//!
//! The machine is never trusted for identity or content:
//!
//! - the resource is replaced: `service.name` `macrod`, the caller's harness
//!   id and the source;
//! - only `teammate.*` and `macrod.*` spans pass, with allowlisted
//!   attributes, values cut to [`MAX_VALUE_CHARS`], and no events or links;
//! - a span naming an `install_id` passes only when that install runs on, or
//!   is leaving, the caller's machine;
//! - [`MAX_BODY_BYTES`] per request, [`MAX_SPANS`] spans, and
//!   [`MAX_REQUESTS_PER_WINDOW`] requests per machine per [`RATE_WINDOW`].
//!
//! Metadata only: the allowlist has no field that carries prompts, tool
//! payloads, environment, credentials, file contents or host paths.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, FromRef, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use futures::future::BoxFuture;
use harness_id::HarnessId;
use macro_authorization::{
    HarnessOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use opentelemetry_proto::tonic::collector::trace::v1::{
    ExportTracePartialSuccess, ExportTraceServiceRequest, ExportTraceServiceResponse,
    trace_service_client::TraceServiceClient,
};
use opentelemetry_proto::tonic::common::v1::{AnyValue, KeyValue, any_value};
use opentelemetry_proto::tonic::resource::v1::Resource;
use opentelemetry_proto::tonic::trace::v1::{ResourceSpans, Span};
use prost::Message as _;
use tokio::time::Instant;

use super::InstallStore;

#[cfg(test)]
mod test;

/// The largest request body accepted.
pub(crate) const MAX_BODY_BYTES: usize = 256 * 1024;
/// The most spans one request may carry; the rest are rejected.
pub(crate) const MAX_SPANS: usize = 512;
/// The longest string attribute value kept, in characters.
pub(crate) const MAX_VALUE_CHARS: usize = 256;
/// Requests one machine may send per [`RATE_WINDOW`].
pub(crate) const MAX_REQUESTS_PER_WINDOW: u32 = 12;
/// The rate limit's window.
pub(crate) const RATE_WINDOW: Duration = Duration::from_secs(60);

/// Span name prefixes a machine may export.
const SPAN_PREFIXES: [&str; 2] = ["teammate.", "macrod."];

/// Span attributes a machine may export: opaque ids, versions, counts,
/// states and outcomes. Anything else is dropped.
const ALLOWED_ATTRIBUTES: [&str; 27] = [
    "install_id",
    "generation",
    "delivery",
    "attempt",
    "state",
    "outcome",
    "reason",
    "phase",
    "image_id",
    "previous_image_id",
    "runtime_version",
    "code_version",
    "engine",
    "rootless",
    "user_namespaces",
    "running",
    "installs",
    "problem",
    "exit_code",
    "retry",
    "rolled_back",
    "duration_ms",
    "connected",
    "busy_ns",
    "idle_ns",
    "otel.status_code",
    "error.type",
];

/// The attribute naming an install.
const INSTALL_ATTRIBUTE: &str = "install_id";

/// Sends sanitized spans on to this service's collector.
pub(crate) trait TraceForwarder: Send + Sync + 'static {
    fn forward(
        &self,
        request: ExportTraceServiceRequest,
    ) -> BoxFuture<'_, Result<(), ForwardFailed>>;
}

/// The collector refused or was unreachable; nothing secret in it.
#[derive(Debug, thiserror::Error)]
#[error("the collector did not take the spans")]
pub(crate) struct ForwardFailed;

/// Forwards over OTLP/gRPC to the endpoint the service exports its own
/// spans to.
pub(crate) struct CollectorForwarder {
    client: TraceServiceClient<tonic::transport::Channel>,
}

impl CollectorForwarder {
    /// Connects lazily: a down collector fails each forward, not startup.
    pub(crate) fn new(endpoint: String) -> anyhow::Result<Self> {
        let channel = tonic::transport::Endpoint::from_shared(endpoint)?
            .timeout(Duration::from_secs(5))
            .connect_lazy();
        Ok(Self {
            client: TraceServiceClient::new(channel),
        })
    }
}

impl TraceForwarder for CollectorForwarder {
    fn forward(
        &self,
        request: ExportTraceServiceRequest,
    ) -> BoxFuture<'_, Result<(), ForwardFailed>> {
        let mut client = self.client.clone();
        Box::pin(async move {
            client.export(request).await.map(|_| ()).map_err(|status| {
                tracing::warn!(code = ?status.code(), "the collector refused teammate spans");
                ForwardFailed
            })
        })
    }
}

/// Requests per machine in the current window.
#[derive(Default)]
pub(crate) struct RateLimit {
    windows: std::sync::Mutex<HashMap<HarnessId, (Instant, u32)>>,
}

impl RateLimit {
    /// Count a request; `Err` with the wait when the machine is over.
    fn admit(&self, harness: HarnessId, now: Instant) -> Result<(), Duration> {
        let mut windows = self
            .windows
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Forget machines whose window ended, so the map stays small.
        windows.retain(|_, (started, _)| now.duration_since(*started) < RATE_WINDOW);
        let (started, count) = windows.entry(harness).or_insert((now, 0));
        if *count >= MAX_REQUESTS_PER_WINDOW {
            return Err(RATE_WINDOW.saturating_sub(now.duration_since(*started)));
        }
        *count += 1;
        Ok(())
    }
}

/// What sanitizing kept, and how many spans it rejected.
#[derive(Debug, PartialEq)]
pub(crate) struct Sanitized {
    pub(crate) request: ExportTraceServiceRequest,
    pub(crate) kept: usize,
    pub(crate) rejected: usize,
}

fn string_value(value: impl Into<String>) -> Option<AnyValue> {
    Some(AnyValue {
        value: Some(any_value::Value::StringValue(value.into())),
    })
}

fn attribute(key: &str, value: impl Into<String>) -> KeyValue {
    KeyValue {
        key: key.to_owned(),
        value: string_value(value),
    }
}

/// `value` with long strings cut, and nested or binary values dropped.
fn bounded(value: Option<AnyValue>) -> Option<AnyValue> {
    match value?.value? {
        any_value::Value::StringValue(text) => {
            string_value(text.chars().take(MAX_VALUE_CHARS).collect::<String>())
        }
        scalar @ (any_value::Value::BoolValue(_)
        | any_value::Value::IntValue(_)
        | any_value::Value::DoubleValue(_)) => Some(AnyValue {
            value: Some(scalar),
        }),
        _ => None,
    }
}

fn install_of(span: &Span) -> Option<&str> {
    span.attributes
        .iter()
        .find(|attribute| attribute.key == INSTALL_ATTRIBUTE)
        .and_then(
            |attribute| match attribute.value.as_ref()?.value.as_ref()? {
                any_value::Value::StringValue(install) => Some(install.as_str()),
                _ => None,
            },
        )
}

/// One span, kept to its metadata.
fn sanitized_span(mut span: Span) -> Span {
    span.attributes = std::mem::take(&mut span.attributes)
        .into_iter()
        .filter(|attribute| ALLOWED_ATTRIBUTES.contains(&attribute.key.as_str()))
        .filter_map(|attribute| {
            Some(KeyValue {
                value: Some(bounded(attribute.value)?),
                key: attribute.key,
            })
        })
        .collect();
    span.dropped_attributes_count = 0;
    span.dropped_events_count += u32::try_from(span.events.len()).unwrap_or(u32::MAX);
    span.events.clear();
    span.dropped_links_count += u32::try_from(span.links.len()).unwrap_or(u32::MAX);
    span.links.clear();
    span.trace_state.clear();
    if let Some(status) = span.status.as_mut() {
        status.message = status.message.chars().take(MAX_VALUE_CHARS).collect();
    }
    span
}

/// Keep `request`'s allowed spans from `harness`, stamped with it. `installs`
/// are the install ids the machine may speak for.
pub(crate) fn sanitize(
    request: ExportTraceServiceRequest,
    harness: HarnessId,
    installs: &HashSet<String>,
) -> Sanitized {
    let mut kept = Vec::new();
    let mut rejected = 0;
    for span in request
        .resource_spans
        .into_iter()
        .flat_map(|resource| resource.scope_spans)
        .flat_map(|scope| scope.spans)
    {
        let allowed_name = SPAN_PREFIXES
            .iter()
            .any(|prefix| span.name.starts_with(prefix));
        let own_install = install_of(&span).is_none_or(|install| installs.contains(install));
        if allowed_name && own_install && kept.len() < MAX_SPANS {
            kept.push(sanitized_span(span));
        } else {
            rejected += 1;
        }
    }
    let count = kept.len();
    let resource_spans = if kept.is_empty() {
        Vec::new()
    } else {
        vec![ResourceSpans {
            resource: Some(Resource {
                attributes: vec![
                    attribute("service.name", "macrod"),
                    attribute("macro.harness_id", harness.to_string()),
                    attribute("macro.telemetry.source", "self_hosted_macrod"),
                ],
                dropped_attributes_count: 0,
                entity_refs: Vec::new(),
            }),
            scope_spans: vec![opentelemetry_proto::tonic::trace::v1::ScopeSpans {
                scope: Some(
                    opentelemetry_proto::tonic::common::v1::InstrumentationScope {
                        name: "macrod".to_owned(),
                        ..Default::default()
                    },
                ),
                spans: kept,
                schema_url: String::new(),
            }],
            schema_url: String::new(),
        }]
    };
    Sanitized {
        request: ExportTraceServiceRequest { resource_spans },
        kept: count,
        rejected,
    }
}

/// The ingest's state.
pub(crate) struct TelemetryState<Auth> {
    pub(crate) store: Arc<dyn InstallStore>,
    pub(crate) forwarder: Arc<dyn TraceForwarder>,
    pub(crate) limit: Arc<RateLimit>,
    pub(crate) authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> Clone for TelemetryState<Auth> {
    fn clone(&self) -> Self {
        Self {
            store: Arc::clone(&self.store),
            forwarder: Arc::clone(&self.forwarder),
            limit: Arc::clone(&self.limit),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<TelemetryState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &TelemetryState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// `POST /teammates/telemetry`.
pub(crate) fn router<Auth: MacroAuthorizationService>(state: TelemetryState<Auth>) -> Router {
    Router::new()
        .route("/teammates/telemetry", post(ingest::<Auth>))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

const PROTOBUF: &str = "application/x-protobuf";

fn protobuf(response: ExportTraceServiceResponse) -> Response {
    (
        [(header::CONTENT_TYPE, HeaderValue::from_static(PROTOBUF))],
        response.encode_to_vec(),
    )
        .into_response()
}

#[tracing::instrument(
    name = "teammate.telemetry",
    skip_all,
    fields(
        harness = %caller.authorization.harness_id,
        kept = tracing::field::Empty,
        rejected = tracing::field::Empty,
        outcome = tracing::field::Empty,
    )
)]
async fn ingest<Auth: MacroAuthorizationService>(
    State(state): State<TelemetryState<Auth>>,
    caller: MacroAuthorizationExtractor<Auth, HarnessOnly>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let span = tracing::Span::current();
    let harness = caller.authorization.harness_id;
    let outcome = |outcome: &'static str| span.record("outcome", outcome);

    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some(PROTOBUF)
    {
        outcome("unsupported_media_type");
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    if let Err(wait) = state.limit.admit(harness, Instant::now()) {
        outcome("rate_limited");
        let seconds = wait.as_secs().max(1).to_string();
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, seconds)],
        )
            .into_response();
    }
    let Ok(request) = ExportTraceServiceRequest::decode(body) else {
        outcome("malformed");
        return StatusCode::BAD_REQUEST.into_response();
    };
    let installs = match state.store.installs_on(harness).await {
        Ok(rows) => rows
            .into_iter()
            .map(|row| row.install_id.to_string())
            .collect::<HashSet<_>>(),
        Err(error) => {
            tracing::error!(error = ?error, "could not read the machine's installs");
            outcome("unavailable");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    let sanitized = sanitize(request, harness, &installs);
    span.record("kept", sanitized.kept);
    span.record("rejected", sanitized.rejected);
    if sanitized.kept > 0 && state.forwarder.forward(sanitized.request).await.is_err() {
        // The machine keeps its bounded buffer and retries.
        outcome("unavailable");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    outcome("accepted");
    protobuf(ExportTraceServiceResponse {
        partial_success: (sanitized.rejected > 0).then(|| ExportTracePartialSuccess {
            rejected_spans: i64::try_from(sanitized.rejected).unwrap_or(i64::MAX),
            error_message: "spans outside the teammate telemetry allowlist were dropped".to_owned(),
        }),
    })
}
