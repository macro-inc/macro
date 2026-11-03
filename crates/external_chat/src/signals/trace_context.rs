//! W3C trace context carried across the Postgres hops between DSS and the
//! session service: in `NOTIFY` payloads and in send rows. Without a global
//! propagator, or outside any span, nothing is carried.

use opentelemetry::propagation::{Extractor, Injector};
use opentelemetry::trace::TraceContextExt as _;
use std::collections::HashMap;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

const TRACEPARENT: &str = "traceparent";

struct Carrier<'a>(&'a mut HashMap<String, String>);

impl Injector for Carrier<'_> {
    fn set(&mut self, key: &str, value: String) {
        self.0.insert(key.to_owned(), value);
    }
}

struct Single<'a>(&'a str);

impl Extractor for Single<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        (key == TRACEPARENT).then_some(self.0)
    }

    fn keys(&self) -> Vec<&str> {
        vec![TRACEPARENT]
    }
}

/// The current span's `traceparent`, when it has a valid trace context.
pub fn current() -> Option<String> {
    let context = tracing::Span::current().context();
    if !context.span().span_context().is_valid() {
        return None;
    }
    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut Carrier(&mut carrier));
    });
    carrier.remove(TRACEPARENT)
}

/// Make `span` a child of the remote span named by `traceparent`. Missing or
/// malformed context leaves the span where it is.
pub fn adopt(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &Single(traceparent))
    });
    if context.span().span_context().is_valid() {
        let _ = span.set_parent(context);
    }
}
