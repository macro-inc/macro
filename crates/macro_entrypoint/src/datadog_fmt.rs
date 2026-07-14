//! Datadog trace-log correlation for JSON logs.
//!
//! Wraps a [`FormatEvent`] to inject `dd.trace_id` and `dd.span_id` into each
//! JSON log line so that Datadog APM can correlate logs with distributed traces.

use opentelemetry::trace::TraceContextExt as _;
use tracing::Subscriber;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::{
    fmt::{FmtContext, FormatEvent, FormatFields, format},
    registry::LookupSpan,
};

/// Wraps an inner [`FormatEvent`] formatter to inject `dd.trace_id` and
/// `dd.span_id` into each JSON log line.
///
/// Datadog expects trace IDs as the lower 64 bits of the 128-bit OpenTelemetry
/// trace ID, represented as a decimal string.
pub(crate) struct DatadogFormat<F> {
    pub(crate) inner: F,
}

impl<S, N, F> FormatEvent<S, N> for DatadogFormat<F>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
    F: FormatEvent<S, N>,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: format::Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> std::fmt::Result {
        // Delegate to the inner JSON formatter, writing to a buffer.
        let mut buf = String::new();
        self.inner
            .format_event(ctx, format::Writer::new(&mut buf), event)?;

        // Parse the JSON, inject DD trace fields, re-serialize.
        let trimmed = buf.trim_end();
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(mut json) => {
                if let Some(obj) = json.as_object_mut() {
                    inject_dd_trace_context(obj);
                }
                let out = serde_json::to_string(&json).map_err(|_| std::fmt::Error)?;
                writeln!(writer, "{out}")
            }
            // If parsing fails, pass the original output through unchanged.
            Err(_) => writer.write_str(&buf),
        }
    }
}

/// Read the OpenTelemetry span context from the current [`tracing::Span`] and
/// insert `dd.trace_id` / `dd.span_id` as decimal strings.
fn inject_dd_trace_context(obj: &mut serde_json::Map<String, serde_json::Value>) {
    let span = tracing::Span::current();
    let cx = span.context();
    let otel_span = cx.span();
    let sc = otel_span.span_context();

    if !sc.is_valid() {
        return;
    }

    // Datadog trace ID = lower 64 bits of the 128-bit OTel trace ID, as decimal.
    let trace_bytes = sc.trace_id().to_bytes();
    let dd_trace_id = u64::from_be_bytes(
        trace_bytes[8..16]
            .try_into()
            .expect("slice is always 8 bytes"),
    );
    let dd_span_id = u64::from_be_bytes(sc.span_id().to_bytes());

    obj.insert(
        "dd.trace_id".into(),
        serde_json::Value::String(dd_trace_id.to_string()),
    );
    obj.insert(
        "dd.span_id".into(),
        serde_json::Value::String(dd_span_id.to_string()),
    );
}
