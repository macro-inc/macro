#![deny(missing_docs)]
//! This crate provides small reusable tower-http utilities which are useful across macro's http services

#[cfg(test)]
mod test;
use std::{
    cmp,
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
    trace::{DefaultMakeSpan, DefaultOnRequest, OnFailure, OnResponse, TraceLayer},
};
use tracing::{Level, Span};

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

/// fork of the [DefaultOnResponse] which is deisgined to work with [RequestIdBuilder]
/// This emits a tracing warn event if a request takes more than a certain threshold to complete.
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

struct Latency {
    duration: Duration,
}

impl std::fmt::Display for Latency {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ms", self.duration.as_millis())
    }
}

impl<B> OnResponse<B> for CustomOnResponse {
    fn on_response(self, response: &Response<B>, latency: Duration, span: &Span) {
        let level = match latency.cmp(&self.warning_threshold) {
            cmp::Ordering::Less => Level::INFO,
            cmp::Ordering::Equal | cmp::Ordering::Greater => Level::WARN,
        };

        let latency = Latency { duration: latency };

        let response_headers = tracing::field::debug(response.headers());
        match level {
            Level::ERROR => tracing::error!(
                parent: span,
                %latency,
                status = response.status().as_u16(),
                response_headers,
                "finished processing request"
            ),
            Level::WARN => tracing::warn!(
                parent: span,
                %latency,
                status = response.status().as_u16(),
                response_headers,
                "finished processing request"
            ),
            Level::INFO => tracing::info!(
                parent: span,
                %latency,
                status = response.status().as_u16(),
                response_headers,
                "finished processing request"
            ),
            Level::DEBUG => tracing::debug!(
                parent: span,
                %latency,
                status = response.status().as_u16(),
                response_headers,
                "finished processing request"
            ),
            Level::TRACE => tracing::trace!(
                parent: span,
                %latency,
                status = response.status().as_u16(),
                response_headers,
                "finished processing request"
            ),
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
        let latency = Latency { duration: latency };

        tracing::error!(
            parent: span,
            classification = %failure_classification,
            %latency,
            "response failed"
        );
    }
}

type ServiceBuilderAlias = ServiceBuilder<
    Stack<
        PropagateRequestIdLayer,
        Stack<
            TraceLayer<
                SharedClassifier<ServerErrorsAsFailures>,
                DefaultMakeSpan,
                DefaultOnRequest,
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
                    .make_span_with(DefaultMakeSpan::new().include_headers(true))
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
