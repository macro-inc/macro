use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::WithExportConfig as _;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::layer::SubscriberExt as _;

use crate::ConfigLoader;

/// A telemetry initialization error.
#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    /// The OTLP span exporter could not be created.
    #[error("failed to create OTLP span exporter: {0}")]
    Exporter(#[from] opentelemetry_otlp::ExporterBuildError),
    /// A global subscriber was already installed.
    #[error("failed to install tracing subscriber: {0}")]
    Subscriber(#[from] tracing::subscriber::SetGlobalDefaultError),
}

/// Owns the tracing provider so pending spans can be flushed at shutdown.
pub struct Telemetry {
    provider: SdkTracerProvider,
}

impl Telemetry {
    /// Install tracing with OTLP export when a standard OTLP endpoint is set.
    pub fn init(service_name: &'static str, config: &ConfigLoader) -> Result<Self, TelemetryError> {
        opentelemetry::global::set_text_map_propagator(
            opentelemetry_sdk::propagation::TraceContextPropagator::new(),
        );

        let endpoint = config
            .optional("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
            .or_else(|| config.optional("OTEL_EXPORTER_OTLP_ENDPOINT"))
            .filter(|value| !value.is_empty());
        let resource = opentelemetry_sdk::Resource::builder()
            .with_service_name(
                config
                    .optional("OTEL_SERVICE_NAME")
                    .unwrap_or(service_name)
                    .to_owned(),
            )
            .build();
        let mut builder = SdkTracerProvider::builder().with_resource(resource);
        if let Some(endpoint) = endpoint {
            let exporter = opentelemetry_otlp::SpanExporter::builder()
                .with_tonic()
                .with_endpoint(endpoint)
                .build()?;
            builder = builder.with_batch_exporter(exporter);
        }
        let provider = builder.build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_subscriber::EnvFilter::new(
                config.optional("RUST_LOG").unwrap_or("info"),
            ))
            .with(tracing_subscriber::fmt::layer())
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer(service_name)));
        tracing::subscriber::set_global_default(subscriber)?;
        Ok(Self { provider })
    }

    /// Flush spans before the service exits.
    pub fn shutdown(self) -> Result<(), opentelemetry_sdk::error::OTelSdkError> {
        self.provider.shutdown()
    }
}
