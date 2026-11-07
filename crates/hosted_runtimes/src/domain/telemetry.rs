//! Context carried by durable computer work, independent of its transport.
use opentelemetry::{KeyValue, global, trace::TraceContextExt};
use std::collections::HashMap;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Current W3C context, absent when no tracing provider is enabled.
pub fn traceparent() -> Option<String> {
    let mut carrier = HashMap::new();
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&tracing::Span::current().context(), &mut carrier)
    });
    carrier.remove("traceparent")
}

/// Attach durable context before entering a new span; already-running callbacks link instead.
pub fn attach(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let carrier = HashMap::from([("traceparent".to_owned(), traceparent.to_owned())]);
    let parent = global::get_text_map_propagator(|propagator| propagator.extract(&carrier));
    let origin = parent.span().span_context().clone();
    if !origin.is_valid() {
        return;
    }
    if span.set_parent(parent).is_err() {
        span.add_link(origin);
    }
}

/// Link an already-running callback to the durable provisioning trace.
pub fn resume(traceparent: Option<&str>) {
    attach(&tracing::Span::current(), traceparent);
}

/// Record a failed attempt even when the worker schedules a retry successfully.
pub fn effect_failed(phase: &str) {
    tracing::Span::current().record("otel.status_code", "ERROR");
    global::meter("hosted_runtimes")
        .u64_counter("computer.effect.failures")
        .build()
        .add(1, &[KeyValue::new("phase", phase.to_owned())]);
}

/// Time from reservation to the first macrod connection, without entity metric labels.
pub fn provisioned(seconds: f64) {
    global::meter("hosted_runtimes")
        .f64_histogram("computer.provisioning.duration")
        .with_unit("s")
        .build()
        .record(seconds, &[]);
}

#[cfg(test)]
mod test;
