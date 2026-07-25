use opentelemetry::propagation::{Extractor, TextMapPropagator};
use opentelemetry::trace::{SpanId, TraceContextExt, TraceId};
use opentelemetry_sdk::propagation::TraceContextPropagator;

/// W3C trace context header (and query param, for websocket connects).
pub const TRACEPARENT: &str = "traceparent";

/// Parsed W3C `traceparent` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraceParent {
    pub trace_id: [u8; 16],
    pub span_id: [u8; 8],
    pub sampled: bool,
}

impl TraceParent {
    /// Parse a W3C `traceparent` value with the standard propagator, which owns
    /// the version / flags / id validation. Returns `None` for anything the
    /// spec rejects (the extracted span context is then invalid).
    pub fn parse(value: &str) -> Option<Self> {
        let cx = TraceContextPropagator::new().extract(&TraceparentCarrier::new(value));
        let sc = cx.span().span_context().clone();
        sc.is_valid().then(|| Self {
            trace_id: sc.trace_id().to_bytes(),
            span_id: sc.span_id().to_bytes(),
            sampled: sc.trace_flags().is_sampled(),
        })
    }

    pub fn trace_id_hex(&self) -> String {
        TraceId::from_bytes(self.trace_id).to_string()
    }

    pub fn span_id_hex(&self) -> String {
        SpanId::from_bytes(self.span_id).to_string()
    }
}

/// Adapts our single `traceparent` value (a query param or header) to OTel's
/// map-oriented propagation API.
struct TraceparentCarrier(Option<String>);

impl TraceparentCarrier {
    fn new(value: &str) -> Self {
        Self(Some(value.to_string()))
    }
}

impl Extractor for TraceparentCarrier {
    fn get(&self, key: &str) -> Option<&str> {
        if key == TRACEPARENT {
            self.0.as_deref()
        } else {
            None
        }
    }

    fn keys(&self) -> Vec<&str> {
        if self.0.is_some() {
            vec![TRACEPARENT]
        } else {
            vec![]
        }
    }
}

/// Raw `traceparent` from a request — header first, then a query param of
/// the same name (browsers can't set websocket headers). Only returned when
/// it parses as valid W3C trace context.
pub fn traceparent_value(req: &worker::Request) -> Option<String> {
    let raw = match req.headers().get(TRACEPARENT) {
        Ok(Some(value)) => Some(value),
        _ => req
            .url()
            .ok()?
            .query_pairs()
            .find(|(k, _)| k == TRACEPARENT)
            .map(|(_, v)| v.into_owned()),
    };
    raw.filter(|v| TraceParent::parse(v).is_some())
}

/// Parsed remote trace context for a request, when present and valid.
pub fn traceparent_from_request(req: &worker::Request) -> Option<TraceParent> {
    traceparent_value(req).and_then(|v| TraceParent::parse(&v))
}

/// `(trace.remote_id, trace.remote_parent)` field values for a root span.
/// Empty strings when there is no remote context, so callers can pass them
/// unconditionally to span macros (the layer treats empty as absent).
pub fn remote_fields(tp: Option<&TraceParent>) -> (String, String) {
    tp.map(|t| (t.trace_id_hex(), t.span_id_hex()))
        .unwrap_or_default()
}

pub(super) fn parse_trace_id(s: &str) -> Option<[u8; 16]> {
    TraceId::from_hex(s)
        .ok()
        .filter(|id| *id != TraceId::INVALID)
        .map(|id| id.to_bytes())
}

pub(super) fn parse_span_id(s: &str) -> Option<[u8; 8]> {
    SpanId::from_hex(s)
        .ok()
        .filter(|id| *id != SpanId::INVALID)
        .map(|id| id.to_bytes())
}
