//! W3C trace context that also accepts Trace Context Level 2 flags.

#[cfg(test)]
mod test;

use opentelemetry::Context;
use opentelemetry::propagation::{
    Extractor, Injector, TextMapPropagator, text_map_propagator::FieldIter,
};
use opentelemetry_sdk::propagation::TraceContextPropagator;

const TRACEPARENT: &str = "traceparent";
/// `00-` + 32 hex trace id + `-` + 16 hex span id + `-` + 2 hex flags.
const VERSION_00_LEN: usize = 55;
const FLAGS_AT: usize = 53;
const SAMPLED: u8 = 0x01;

/// `TraceContextPropagator`, except that a version-00 `traceparent` with
/// flags beyond `sampled` is read for its `sampled` bit instead of refused.
///
/// `opentelemetry_sdk` 0.31 refuses a version-00 `traceparent` whose flags
/// exceed 2, so a caller that sets Trace Context Level 2's random-trace-id
/// flag (0x02) on a sampled trace (`-03`) starts a new trace here. Cloudflare
/// Workers instrumented with `@microlabs/otel-cf-workers` send exactly that,
/// so every Worker request reached the service as a trace of its own.
#[derive(Debug, Default)]
pub(crate) struct TraceContextLevel2(TraceContextPropagator);

impl TextMapPropagator for TraceContextLevel2 {
    fn inject_context(&self, cx: &Context, injector: &mut dyn Injector) {
        self.0.inject_context(cx, injector);
    }

    fn extract_with_context(&self, cx: &Context, extractor: &dyn Extractor) -> Context {
        let extractor = KnownFlags::new(extractor);
        self.0.extract_with_context(cx, &extractor)
    }

    fn fields(&self) -> FieldIter<'_> {
        self.0.fields()
    }
}

/// An extractor whose version-00 `traceparent` keeps only the `sampled` flag.
struct KnownFlags<'a> {
    inner: &'a dyn Extractor,
    traceparent: Option<String>,
}

impl<'a> KnownFlags<'a> {
    fn new(inner: &'a dyn Extractor) -> Self {
        let traceparent = inner.get(TRACEPARENT).and_then(known_flags_only);
        Self { inner, traceparent }
    }
}

/// `value` with its flags narrowed to `sampled`, when it is a version-00
/// `traceparent` carrying other flags; `None` leaves it as it came.
fn known_flags_only(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() != VERSION_00_LEN || !value.starts_with("00-") {
        return None;
    }
    let flags = u8::from_str_radix(value.get(FLAGS_AT..)?, 16).ok()?;
    if flags & !SAMPLED == 0 {
        return None;
    }
    Some(format!("{}{:02x}", value.get(..FLAGS_AT)?, flags & SAMPLED))
}

impl Extractor for KnownFlags<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        if key.eq_ignore_ascii_case(TRACEPARENT)
            && let Some(traceparent) = &self.traceparent
        {
            return Some(traceparent);
        }
        self.inner.get(key)
    }

    fn keys(&self) -> Vec<&str> {
        self.inner.keys()
    }
}
