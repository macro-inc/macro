//! W3C trace context carried in ACP's extensible `_meta` object.
//!
//! Only context is transported: content capture and GenAI span ownership stay
//! with the session actor. Runtimes that do not understand this key ignore it.

#[cfg(test)]
mod test;

use opentelemetry::propagation::{Extractor, Injector};
use opentelemetry::trace::TraceContextExt as _;
use serde_json::{Map, Value};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

const TRACE_CONTEXT: &str = "macro.dev/trace-context";

struct Carrier<'a>(&'a Map<String, Value>);

impl Extractor for Carrier<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key)?.as_str()
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(String::as_str).collect()
    }
}

struct CarrierMut<'a>(&'a mut Map<String, Value>);

impl Injector for CarrierMut<'_> {
    fn set(&mut self, key: &str, value: String) {
        self.0.insert(key.to_owned(), Value::String(value));
    }
}

/// Replace our trace-context metadata with `span`'s context, preserving all
/// other ACP metadata. A disabled span clears any stale context in our key.
pub fn inject(span: &tracing::Span, meta: &mut Map<String, Value>) {
    meta.remove(TRACE_CONTEXT);
    let context = span.context();
    if !context.span().span_context().is_valid() {
        return;
    }
    let mut carrier = Map::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut CarrierMut(&mut carrier));
    });
    if !carrier.is_empty() {
        meta.insert(TRACE_CONTEXT.to_owned(), Value::Object(carrier));
    }
}

/// Parent runtime work under the invocation that sent its ACP prompt. Missing
/// or malformed context is ignored; unrelated ambient context is never used
/// as an extraction fallback.
pub fn set_parent(span: &tracing::Span, meta: Option<&Map<String, Value>>) {
    let Some(carrier) = meta.and_then(|meta| meta.get(TRACE_CONTEXT)?.as_object()) else {
        return;
    };
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &Carrier(carrier))
    });
    if context.span().span_context().is_valid() {
        let _ = span.set_parent(context);
    }
}
