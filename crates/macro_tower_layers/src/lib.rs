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

use http::{HeaderValue, Request, Response};
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

/// Creates INFO-level HTTP server spans with safe OpenTelemetry attributes.
///
/// Request and response headers are intentionally excluded.
#[derive(Clone, Copy, Debug, Default)]
pub struct MakeHttpRequestSpan;

impl<B> MakeSpan<B> for MakeHttpRequestSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let request_id = request
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();

        tracing::info_span!(
            "http.request",
            otel.kind = "server",
            "http.request.method" = %request.method(),
            "url.path" = request.uri().path(),
            "request.id" = request_id,
            "http.response.status_code" = tracing::field::Empty,
            latency_ms = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        )
    }
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
                MakeHttpRequestSpan,
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
                    .make_span_with(MakeHttpRequestSpan)
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
