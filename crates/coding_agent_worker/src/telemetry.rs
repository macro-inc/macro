//! Opt-in service/enrollment tracing; stdout remains the daemon protocol.
use opentelemetry::trace::TracerProvider;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

macro_env_var::maybe_env_vars! { pub struct OtelExporterOtlpEndpoint; }

pub(crate) const PROVISION_PARENT_PATH: &str = "/var/lib/macrod/provision.traceparent";
static PROVISION_PARENT: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();

/// Parent a supervision span before it is entered; no I/O on polling paths.
pub(crate) fn attach(span: &tracing::Span) {
    hosted_runtimes::domain::telemetry::attach(
        span,
        PROVISION_PARENT.get().and_then(|value| value.as_deref()),
    );
}

pub(crate) struct Telemetry(Option<SdkTracerProvider>);

impl Drop for Telemetry {
    fn drop(&mut self) {
        if let Some(provider) = &self.0
            && let Err(error) = provider.shutdown()
        {
            eprintln!("macrod telemetry shutdown failed: {error}");
        }
    }
}

pub(crate) fn install() -> Telemetry {
    let _ = PROVISION_PARENT.set(std::fs::read_to_string(PROVISION_PARENT_PATH).ok());
    let computer_id = std::fs::read_to_string("/var/lib/macrod/enrolled")
        .ok()
        .and_then(|value| uuid::Uuid::parse_str(value.trim()).ok());
    let provider = OtelExporterOtlpEndpoint::new().map(|endpoint| {
        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_tonic()
            .with_endpoint(endpoint.to_string())
            .build()
            .expect("invalid macrod OTLP exporter configuration");
        SdkTracerProvider::builder()
            .with_resource(
                opentelemetry_sdk::Resource::builder()
                    .with_service_name("macrod")
                    .with_attributes(
                        computer_id
                            .map(|id| opentelemetry::KeyValue::new("computer_id", id.to_string())),
                    )
                    .build(),
            )
            .with_batch_exporter(exporter)
            .build()
    });
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let layer = provider.as_ref().map(|provider| {
        // Only audited metadata spans are exported; ACP and tool payloads stay private.
        tracing_opentelemetry::layer()
            .with_tracer(provider.tracer("macrod"))
            .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
                metadata.name().starts_with("macrod.persona") || metadata.name() == "run_enroll"
            }))
    });
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(layer)
        .init();
    Telemetry(provider)
}
