//! Records the spans one test creates, whatever other tests do meanwhile.

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use tracing::Dispatch;
use tracing::subscriber::DefaultGuard;
use tracing_subscriber::layer::SubscriberExt as _;

/// The spans finished on this thread while it is alive.
pub(crate) struct Capture {
    exporter: InMemorySpanExporter,
    provider: SdkTracerProvider,
    _guard: DefaultGuard,
    _second: Dispatch,
}

impl Capture {
    /// Installs an OpenTelemetry subscriber for the current thread.
    pub(crate) fn start() -> Self {
        opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let guard = tracing::subscriber::set_default(
            tracing_subscriber::registry()
                .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test"))),
        );
        // With a single dispatcher registered, tracing computes a callsite's
        // interest from the default of whichever thread reaches it first, so
        // a test on another thread with no subscriber can switch this one's
        // spans off for good. A second live dispatcher makes it ask them all.
        let second = Dispatch::new(tracing_subscriber::registry());
        tracing::callsite::rebuild_interest_cache();
        Self {
            exporter,
            provider,
            _guard: guard,
            _second: second,
        }
    }

    /// The spans finished so far.
    pub(crate) fn finished(&self) -> Vec<SpanData> {
        self.provider.force_flush().unwrap();
        self.exporter.get_finished_spans().unwrap()
    }

    /// Asserts no finished span or event recorded anything naming
    /// `email_domain`, which also catches an email that was URL-encoded.
    pub(crate) fn assert_no_email(&self, email_domain: &str) {
        let spans = self.finished();
        for span in &spans {
            let events = span
                .events
                .events
                .iter()
                .flat_map(|event| &event.attributes);
            for attribute in span.attributes.iter().chain(events) {
                let value = attribute.value.as_str();
                assert!(
                    !value.contains(email_domain),
                    "{} recorded {} = {value:?}",
                    span.name,
                    attribute.key
                );
            }
        }
    }
}
