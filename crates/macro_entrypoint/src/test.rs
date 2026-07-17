use super::*;

use opentelemetry::trace::TraceContextExt as _;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_sdk::trace::InMemorySpanExporter;
use std::io;
use std::sync::{Arc, Mutex};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::fmt::MakeWriter;

#[derive(Clone, Default)]
struct SharedWriter(Arc<Mutex<Vec<u8>>>);

impl SharedWriter {
    fn contents(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

impl io::Write for SharedWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for SharedWriter {
    type Writer = SharedWriter;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

fn test_tracer_provider() -> (InMemorySpanExporter, SdkTracerProvider) {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    (exporter, provider)
}

#[test]
fn rust_log_warn_does_not_drop_info_spans() {
    let (exporter, provider) = test_tracer_provider();
    let tracer = provider.tracer("test");

    let otel_layer = tracing_opentelemetry::layer()
        .with_tracer(tracer)
        .with_filter(otel_trace_filter(None));

    let json_format = tracing_subscriber::fmt::format::Format::default()
        .json()
        .with_current_span(true)
        .with_span_list(false)
        .flatten_event(true);

    let logs = SharedWriter::default();
    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .fmt_fields(tracing_subscriber::fmt::format::JsonFields::new())
        .event_format(datadog_fmt::DatadogFormat { inner: json_format })
        .with_writer(logs.clone())
        .with_filter(EnvFilter::new("warn"));

    let subscriber = Registry::default().with(fmt_layer).with(otel_layer);

    // The span context DatadogFormat reads via Span::current() is only observable here
    // outside event dispatch: under a scoped test dispatcher, tracing's re-entrancy guard
    // hands Dispatch::none() to Span::current() inside format_event. Prod installs a global
    // dispatcher, which get_default resolves without the guard.
    let mut current_ids: Option<(TraceId, SpanId)> = None;
    tracing::subscriber::with_default(subscriber, || {
        tracing::info_span!("instrumented_op").in_scope(|| {
            let cx = tracing::Span::current().context();
            let span_cx = cx.span().span_context().clone();
            assert!(span_cx.is_valid());
            current_ids = Some((span_cx.trace_id(), span_cx.span_id()));

            tracing::warn!("warn inside info span");
            tracing::info!("info event is filtered from logs");
        });
    });

    let spans = exporter.get_finished_spans().unwrap();
    assert_eq!(spans.len(), 1);
    assert_eq!(spans[0].name, "instrumented_op");

    let (trace_id, span_id) = current_ids.unwrap();
    assert_eq!(spans[0].span_context.trace_id(), trace_id);
    assert_eq!(spans[0].span_context.span_id(), span_id);

    let output = logs.contents();
    let line = output
        .lines()
        .find(|l| l.contains("warn inside info span"))
        .expect("warn event should be logged");
    assert!(serde_json::from_str::<serde_json::Value>(line).is_ok());
    assert!(!output.contains("info event is filtered from logs"));
}

#[test]
fn global_warn_filter_drops_info_spans() {
    let (exporter, provider) = test_tracer_provider();
    let tracer = provider.tracer("test");

    let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    let subscriber = Registry::default()
        .with(EnvFilter::new("warn"))
        .with(otel_layer);

    tracing::subscriber::with_default(subscriber, || {
        tracing::info_span!("instrumented_op").in_scope(|| {
            tracing::warn!("warn inside info span");
        });
    });

    assert!(exporter.get_finished_spans().unwrap().is_empty());
}

#[test]
fn otel_trace_filter_defaults_to_info() {
    let (exporter, provider) = test_tracer_provider();
    let tracer = provider.tracer("test");

    let otel_layer = tracing_opentelemetry::layer()
        .with_tracer(tracer)
        .with_filter(otel_trace_filter(None));

    let subscriber = Registry::default().with(otel_layer);

    tracing::subscriber::with_default(subscriber, || {
        tracing::info_span!("info_op").in_scope(|| {});
        tracing::debug_span!("debug_op").in_scope(|| {});
    });

    let names: Vec<_> = exporter
        .get_finished_spans()
        .unwrap()
        .into_iter()
        .map(|s| s.name)
        .collect();
    assert_eq!(names, vec!["info_op"]);
}

#[test]
fn otel_trace_filter_invalid_value_falls_back_to_info() {
    let (exporter, provider) = test_tracer_provider();
    let tracer = provider.tracer("test");

    let otel_layer = tracing_opentelemetry::layer()
        .with_tracer(tracer)
        .with_filter(otel_trace_filter(Some("foo=notalevel")));

    let subscriber = Registry::default().with(otel_layer);

    tracing::subscriber::with_default(subscriber, || {
        tracing::info_span!("info_op").in_scope(|| {});
    });

    assert_eq!(exporter.get_finished_spans().unwrap().len(), 1);
}
