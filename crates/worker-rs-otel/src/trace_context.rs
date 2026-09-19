use std::{collections::HashMap, hash::BuildHasher};

use opentelemetry::Context;
use opentelemetry::propagation::TextMapPropagator;
use opentelemetry::trace::{SpanContext, SpanId, TraceContextExt, TraceFlags, TraceId, TraceState};
use opentelemetry_sdk::propagation::TraceContextPropagator;

/// W3C trace-context header and WebSocket query parameter.
pub const TRACEPARENT: &str = "traceparent";

/// Header collection that can provide values for trace-context propagation.
pub trait HeadersLike {
    /// Return a header value as text.
    fn header(&self, name: &str) -> Option<String>;
}

impl<S: BuildHasher> HeadersLike for HashMap<String, String, S> {
    fn header(&self, name: &str) -> Option<String> {
        self.get(name).cloned()
    }
}

impl HeadersLike for http::HeaderMap {
    fn header(&self, name: &str) -> Option<String> {
        self.get(name)?.to_str().ok().map(str::to_owned)
    }
}

impl HeadersLike for worker::Headers {
    fn header(&self, name: &str) -> Option<String> {
        self.get(name).ok().flatten()
    }
}

/// Parse a valid W3C `traceparent` value into OpenTelemetry's span context.
pub fn parse_traceparent(value: &str) -> Option<SpanContext> {
    let carrier = HashMap::from([(TRACEPARENT.to_string(), value.to_string())]);
    let context = TraceContextPropagator::new().extract(&carrier);
    let span_context = context.span().span_context().clone();
    span_context.is_valid().then_some(span_context)
}

pub(super) fn sampled_traceparent(trace_id: [u8; 16], span_id: [u8; 8]) -> Option<String> {
    let span_context = SpanContext::new(
        TraceId::from_bytes(trace_id),
        SpanId::from_bytes(span_id),
        TraceFlags::SAMPLED,
        false,
        TraceState::default(),
    );
    let context = Context::new().with_remote_span_context(span_context);
    let mut carrier = HashMap::new();
    TraceContextPropagator::new().inject_context(&context, &mut carrier);
    carrier.remove(TRACEPARENT)
}

/// Extract remote trace context from a supported header collection.
pub fn traceparent_from_headers(headers: &impl HeadersLike) -> Option<SpanContext> {
    headers
        .header(TRACEPARENT)
        .and_then(|value| parse_traceparent(&value))
}

/// Extract parsed remote trace context from a Worker request.
pub fn traceparent_from_request(request: &worker::Request) -> Option<SpanContext> {
    traceparent_from_headers(request.headers()).or_else(|| {
        request
            .url()
            .ok()?
            .query_pairs()
            .find(|(key, _)| key == TRACEPARENT)
            .and_then(|(_, value)| parse_traceparent(&value))
    })
}

/// Convert optional remote context into reserved tracing span field values.
pub fn remote_fields(traceparent: Option<&SpanContext>) -> (String, String) {
    traceparent
        .map(|value| (value.trace_id().to_string(), value.span_id().to_string()))
        .unwrap_or_default()
}

pub(super) fn parse_trace_id(value: &str) -> Option<[u8; 16]> {
    TraceId::from_hex(value)
        .ok()
        .filter(|id| *id != TraceId::INVALID)
        .map(|id| id.to_bytes())
}

pub(super) fn parse_span_id(value: &str) -> Option<[u8; 8]> {
    SpanId::from_hex(value)
        .ok()
        .filter(|id| *id != SpanId::INVALID)
        .map(|id| id.to_bytes())
}

#[cfg(test)]
mod test;
