//! W3C trace context on the monitor's gRPC hop: the client injects the current
//! span's `traceparent` into request metadata, and the server parents its
//! handler span on it, so a viewer's connect and the collector's subscribe are
//! one trace.

use opentelemetry::propagation::{Extractor, Injector};
use opentelemetry::trace::TraceContextExt as _;
use tonic::metadata::{KeyAndValueRef, MetadataKey, MetadataMap, MetadataValue};
use tonic::service::Interceptor;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

struct MetadataCarrier<'a>(&'a MetadataMap);

impl Extractor for MetadataCarrier<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key)?.to_str().ok()
    }

    fn keys(&self) -> Vec<&str> {
        self.0
            .iter()
            .filter_map(|entry| match entry {
                KeyAndValueRef::Ascii(key, _) => Some(key.as_str()),
                KeyAndValueRef::Binary(..) => None,
            })
            .collect()
    }
}

struct MetadataCarrierMut<'a>(&'a mut MetadataMap);

impl Injector for MetadataCarrierMut<'_> {
    fn set(&mut self, key: &str, value: String) {
        let key = MetadataKey::from_bytes(key.as_bytes());
        let value = MetadataValue::try_from(value);
        if let (Ok(key), Ok(value)) = (key, value) {
            self.0.insert(key, value);
        }
    }
}

/// Writes the current span's trace context into request metadata. A span
/// with no valid context writes nothing.
pub fn inject(metadata: &mut MetadataMap) {
    let context = tracing::Span::current().context();
    if !context.span().span_context().is_valid() {
        return;
    }
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut MetadataCarrierMut(metadata));
    });
}

/// Parents `span` on the trace context in request metadata. Missing or
/// malformed context leaves the span where it is.
pub fn set_parent(span: &tracing::Span, metadata: &MetadataMap) {
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &MetadataCarrier(metadata))
    });
    if context.span().span_context().is_valid() {
        // Only fails when the span is disabled, which leaves nothing to parent.
        let _ = span.set_parent(context);
    }
}

/// A tonic client interceptor that injects the caller's trace context.
#[derive(Clone, Copy, Debug, Default)]
pub struct TraceContextInterceptor;

impl Interceptor for TraceContextInterceptor {
    fn call(
        &mut self,
        mut request: tonic::Request<()>,
    ) -> Result<tonic::Request<()>, tonic::Status> {
        inject(request.metadata_mut());
        Ok(request)
    }
}
