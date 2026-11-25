//! An OpenTelemetry pipeline for tests that read the spans a flow finished.

use opentelemetry::trace::{SpanContext, TraceContextExt as _, TracerProvider as _};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use tracing::subscriber::DefaultGuard;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use tracing_subscriber::layer::SubscriberExt as _;

/// Spans recorded on this thread until dropped.
pub(crate) struct Recorded {
    provider: SdkTracerProvider,
    exporter: InMemorySpanExporter,
    _guard: DefaultGuard,
}

impl Recorded {
    pub(crate) fn start() -> Self {
        opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
        let guard = tracing::subscriber::set_default(subscriber);
        // Another test may have cached a "never" interest for a callsite.
        tracing::callsite::rebuild_interest_cache();
        Self {
            provider,
            exporter,
            _guard: guard,
        }
    }

    /// The finished span named `name`.
    pub(crate) fn finished(&self, name: &str) -> SpanData {
        self.provider.force_flush().unwrap();
        self.exporter
            .get_finished_spans()
            .unwrap()
            .into_iter()
            .find(|span| span.name == name)
            .unwrap_or_else(|| panic!("no finished span {name}"))
    }
}

pub(crate) fn context_of(span: &tracing::Span) -> SpanContext {
    span.context().span().span_context().clone()
}
