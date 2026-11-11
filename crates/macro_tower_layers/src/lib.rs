#![deny(missing_docs)]
//! This crate provides small reusable tower-http utilities which are useful across macro's http services

#[cfg(test)]
mod test;
use std::{
    sync::{
        Arc,
        atomic::{self, AtomicU64},
    },
    time::Duration,
};

use axum::extract::MatchedPath;
use http::{HeaderValue, Request, Response};
use opentelemetry::trace::TraceContextExt;
use tokio::time::MissedTickBehavior;
use tower::{
    ServiceBuilder,
    layer::util::{Identity, Stack},
};
use tower_http::{
    ServiceBuilderExt,
    classify::{ServerErrorsAsFailures, SharedClassifier},
    request_id::{MakeRequestId, PropagateRequestIdLayer, RequestId, SetRequestIdLayer},
    trace::{MakeSpan, OnFailure, OnResponse, TraceLayer},
};
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Creates a safe HTTP request span and adopts an incoming W3C trace context.
///
/// A valid `traceparent` makes the request span a child of that remote span.
/// The global text-map propagator is registered by `macro_entrypoint`.
#[derive(Debug, Clone, Default)]
pub struct MakeSpanWithRemoteParent;

impl<B> MakeSpan<B> for MakeSpanWithRemoteParent {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let span = MakeHttpRequestSpan.make_span(request);
        adopt_trace_headers(&span, request.headers());
        span
    }
}

fn adopt_trace_headers(span: &Span, headers: &http::HeaderMap) {
    let parent = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract(&opentelemetry_http::HeaderExtractor(headers))
    });
    if parent.span().span_context().is_valid() {
        let _ = span.set_parent(parent);
    }
}

/// The current span's W3C `traceparent`, for work that runs after the request
/// that started it (a stored webhook delivery, a queued job).
///
/// Store it with the work and pass it to [`adopt_traceparent`] when the work
/// runs, so both halves are one trace. `None` outside any span or without a
/// global propagator.
pub fn current_traceparent() -> Option<String> {
    let mut headers = http::HeaderMap::new();
    inject_trace_headers(&mut headers);
    headers
        .get(TRACEPARENT)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

/// Make `span` a child of the remote span named by a stored `traceparent`.
/// Missing or malformed context leaves the span where it is.
pub fn adopt_traceparent(span: &Span, traceparent: &str) {
    let Ok(value) = HeaderValue::from_str(traceparent) else {
        return;
    };
    let mut headers = http::HeaderMap::new();
    headers.insert(TRACEPARENT, value);
    adopt_trace_headers(span, &headers);
}

const TRACEPARENT: &str = "traceparent";

/// Injects the current span's W3C trace context into outbound request headers.
///
/// Outbound counterpart of [`MakeSpanWithRemoteParent`]: a downstream service
/// that adopts `traceparent` joins this service's trace. The global text-map
/// propagator is registered by `macro_entrypoint`; without one, or outside any
/// span, this is a no-op.
pub fn inject_trace_headers(headers: &mut http::HeaderMap) {
    let context = Span::current().context();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut opentelemetry_http::HeaderInjector(headers));
    });
}

/// A very simple builder for x-request-ids
#[derive(Default, Clone)]
pub struct RequestIdBuilder(Arc<AtomicU64>);

impl MakeRequestId for RequestIdBuilder {
    fn make_request_id<B>(
        &mut self,
        _request: &Request<B>,
    ) -> Option<tower_http::request_id::RequestId> {
        Some(RequestId::new(HeaderValue::from(
            self.0.fetch_add(1, atomic::Ordering::SeqCst),
        )))
    }
}

/// Records response telemetry on the request span.
///
/// Successful requests only emit an event when their latency meets or exceeds the warning
/// threshold. Failed requests are logged by [`CustomOnFailure`].
#[derive(Clone)]
pub struct CustomOnResponse {
    warning_threshold: Duration,
}

impl CustomOnResponse {
    /// create a new instance of self given a warning threshold duration
    pub fn new_with_threshold(warning_threshold: Duration) -> Self {
        CustomOnResponse { warning_threshold }
    }
}

const HTTP_REQUEST_SPAN_TARGET: &str = "macro_http_request";

/// Creates INFO-level HTTP server spans with safe OpenTelemetry attributes.
///
/// Request and response headers are intentionally excluded. Add
/// `macro_http_request=info` to `RUST_LOG` when log events should include these span fields.
#[derive(Clone, Copy, Debug, Default)]
pub struct MakeHttpRequestSpan;

impl<B> MakeSpan<B> for MakeHttpRequestSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let request_id = request
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        let route = request.extensions().get::<MatchedPath>();
        let url_path = redacted_path(request.uri().path(), route.map(MatchedPath::as_str));
        let span = tracing::info_span!(
            target: HTTP_REQUEST_SPAN_TARGET,
            "http.request",
            otel.kind = "server",
            "http.request.method" = %request.method(),
            "http.route" = tracing::field::Empty,
            "url.path" = url_path.as_ref(),
            "request.id" = request_id,
            "http.response.status_code" = tracing::field::Empty,
            latency_ms = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        if let Some(route) = route {
            span.record("http.route", route.as_str());
        }
        span
    }
}

/// Path parameters that carry a bearer credential (a sign-in session code, a
/// one-time login or merge code, a meeting join or read-receipt token).
/// `url.path` shows the route's placeholder in their place.
const CREDENTIAL_PATH_PARAMS: &[&str] = &["{session_code}", "{code}", "{token}"];

/// The request path for `url.path`, with each credential segment replaced by
/// its route placeholder. Segments are matched from the end, because a nested
/// router sees the path without its prefix while `MatchedPath` keeps it.
/// Without a matched route nothing is replaced; a wildcard route that holds a
/// credential falls back to the route itself.
fn redacted_path<'a>(path: &'a str, route: Option<&'a str>) -> std::borrow::Cow<'a, str> {
    let Some(route) = route.filter(|route| {
        route
            .split('/')
            .any(|segment| CREDENTIAL_PATH_PARAMS.contains(&segment))
    }) else {
        return path.into();
    };
    let route_segments: Vec<&str> = route.split('/').collect();
    let mut segments: Vec<&str> = path.split('/').collect();
    if route_segments.len() < segments.len() || route.contains("{*") {
        return route.into();
    }
    for (segment, route_segment) in segments.iter_mut().rev().zip(route_segments.iter().rev()) {
        if CREDENTIAL_PATH_PARAMS.contains(route_segment) {
            *segment = route_segment;
        }
    }
    segments.join("/").into()
}

fn latency_millis(latency: Duration) -> u64 {
    latency.as_millis().try_into().unwrap_or(u64::MAX)
}

impl<B> OnResponse<B> for CustomOnResponse {
    fn on_response(self, response: &Response<B>, latency: Duration, span: &Span) {
        let status = response.status();
        let latency_ms = latency_millis(latency);
        span.record("http.response.status_code", u64::from(status.as_u16()));
        span.record("latency_ms", latency_ms);

        // Server errors are logged once by CustomOnFailure after this callback returns.
        if !status.is_server_error() && latency >= self.warning_threshold {
            tracing::warn!(
                parent: span,
                latency_ms,
                status = status.as_u16(),
                "slow http request"
            );
        }
    }
}

/// Emits failed-request logs with the request span as the parent so logs include route context.
#[derive(Clone)]
pub struct CustomOnFailure;

impl<FailureClass> OnFailure<FailureClass> for CustomOnFailure
where
    FailureClass: std::fmt::Display,
{
    fn on_failure(&mut self, failure_classification: FailureClass, latency: Duration, span: &Span) {
        let latency_ms = latency_millis(latency);
        span.record("latency_ms", latency_ms);
        span.record("otel.status_code", "ERROR");
        span.record(
            "otel.status_description",
            tracing::field::display(&failure_classification),
        );

        tracing::error!(
            parent: span,
            error = %failure_classification,
            latency_ms,
            "http request failed"
        );
    }
}

type ServiceBuilderAlias = ServiceBuilder<
    Stack<
        PropagateRequestIdLayer,
        Stack<
            TraceLayer<
                SharedClassifier<ServerErrorsAsFailures>,
                MakeSpanWithRemoteParent,
                (),
                CustomOnResponse,
                tower_http::trace::DefaultOnBodyChunk,
                tower_http::trace::DefaultOnEos,
                CustomOnFailure,
            >,
            Stack<SetRequestIdLayer<RequestIdBuilder>, Identity>,
        >,
    >,
>;

/// Spawns a background task that detects tokio runtime starvation.
///
/// Ticks on `interval` and warns if the actual time between ticks exceeds it.
/// A large gap indicates the tokio runtime is not polling tasks promptly, typically caused
/// by blocking work (e.g. synchronous DNS resolution) on the runtime threads.
pub fn spawn_starvation_detector(interval: Duration) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(interval);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        // consume the immediate first tick
        tick.tick().await;
        loop {
            let before = tokio::time::Instant::now();
            tick.tick().await;
            let elapsed = before.elapsed();
            if elapsed > interval + Duration::from_millis(5) {
                tracing::warn!(
                    expected_ms = interval.as_millis() as u64,
                    actual_ms = elapsed.as_millis() as u64,
                    delay_ms = elapsed.saturating_sub(interval).as_millis() as u64,
                    "tokio runtime starvation detected"
                );
            }
        }
    });
}

/// A wrapper over a [ServiceBuilder] which handles both request id and tracing.
/// See [CustomOnResponse] and [RequestIdBuilder] for more info.
pub struct MacroRequestIdAndTracingLayer {
    inner: ServiceBuilderAlias,
}

impl MacroRequestIdAndTracingLayer {
    /// contruct a new instance of self with the input warning threshold
    ///
    /// Also spawns a background [starvation detector](spawn_starvation_detector) that
    /// warns when the tokio runtime is not polling tasks promptly.
    pub fn new(warning_threshold: Duration) -> Self {
        spawn_starvation_detector(Duration::from_millis(250));

        let svc_builder = ServiceBuilder::new()
            .set_x_request_id(RequestIdBuilder::default())
            .layer(
                TraceLayer::new_for_http()
                    .make_span_with(MakeSpanWithRemoteParent)
                    .on_request(())
                    .on_response(CustomOnResponse::new_with_threshold(warning_threshold))
                    .on_failure(CustomOnFailure),
            )
            .propagate_x_request_id();

        MacroRequestIdAndTracingLayer { inner: svc_builder }
    }

    /// return the inner [ServiceBuilder] so that you can call the .layer method
    pub fn into_inner(self) -> ServiceBuilderAlias {
        self.inner
    }
}
