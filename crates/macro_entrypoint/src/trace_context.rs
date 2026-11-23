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
///
/// The random flag is not carried on: the SDK samples and injects with the
/// `sampled` bit alone, so these services propagate as Trace Context Level 1
/// participants, whose unset random flag makes no claim about the trace id.
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
    traceparent: Traceparent,
}

impl<'a> KnownFlags<'a> {
    fn new(inner: &'a dyn Extractor) -> Self {
        let traceparent = inner
            .get(TRACEPARENT)
            .map_or(Traceparent::AsSent, known_flags_only);
        Self { inner, traceparent }
    }
}

/// What the SDK is shown of a `traceparent`.
#[derive(Debug, PartialEq)]
enum Traceparent {
    /// The header as it came: absent, another version, or version 00 with
    /// `sampled` at most.
    AsSent,
    /// A version-00 header with its flags narrowed to `sampled`.
    Narrowed(String),
    /// A version-00 header of the wrong length, or whose flags are not two
    /// lowercase hex digits, which the SDK would read leniently (`+1` or
    /// `1` as sampled): none at all.
    Refused,
}

/// What to show of a `traceparent` sent as `value`.
fn known_flags_only(value: &str) -> Traceparent {
    let value = value.trim();
    if !value.starts_with("00-") {
        return Traceparent::AsSent;
    }
    // Version 00 has exactly one length; the SDK also takes a shorter or
    // longer flags field (`1`, `001`).
    if value.len() != VERSION_00_LEN {
        return Traceparent::Refused;
    }
    let Some((prefix, flags)) = value.split_at_checked(FLAGS_AT) else {
        return Traceparent::Refused;
    };
    // Two lowercase hex digits, as the header requires; `from_str_radix`
    // alone would also take `+3`.
    if !flags
        .bytes()
        .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Traceparent::Refused;
    }
    match u8::from_str_radix(flags, 16) {
        Ok(flags) if flags & !SAMPLED == 0 => Traceparent::AsSent,
        Ok(flags) => Traceparent::Narrowed(format!("{prefix}{:02x}", flags & SAMPLED)),
        Err(_) => Traceparent::Refused,
    }
}

impl Extractor for KnownFlags<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        if key.eq_ignore_ascii_case(TRACEPARENT) {
            return match &self.traceparent {
                Traceparent::AsSent => self.inner.get(key),
                Traceparent::Narrowed(traceparent) => Some(traceparent),
                Traceparent::Refused => None,
            };
        }
        self.inner.get(key)
    }

    fn keys(&self) -> Vec<&str> {
        self.inner.keys()
    }
}
