//! The one global span exporter every span-reading test in this binary shares.
//!
//! Global, not thread-local: tests running alongside reach the same span
//! callsites with no subscriber of their own, and a thread-local default loses
//! that race and sees them disabled. A process has one global subscriber, so
//! tests share it and find their own spans by id or attribute.

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use std::sync::OnceLock;
use tracing_subscriber::layer::SubscriberExt as _;

/// The exporter and the provider that flushes into it.
pub(crate) struct ExportedSpans {
    pub exporter: InMemorySpanExporter,
    pub provider: SdkTracerProvider,
}

/// Install the global subscriber on first use and return its exporter.
pub(crate) fn exported_spans() -> &'static ExportedSpans {
    static SPANS: OnceLock<ExportedSpans> = OnceLock::new();
    SPANS.get_or_init(|| {
        let exporter = InMemorySpanExporter::default();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));
        tracing::subscriber::set_global_default(subscriber)
            .expect("only test_spans installs a global subscriber in this binary");
        ExportedSpans { exporter, provider }
    })
}
