//! Opt-in service/enrollment tracing; stdout remains the daemon protocol.
use opentelemetry::trace::TracerProvider;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

macro_env_var::maybe_env_vars! { pub struct OtelExporterOtlpEndpoint; }

/// Trace headers from the current span, or `parent` (the setup trace an
/// enrollment carries) when this process exports no spans of its own, so the
/// server still joins the trace.
pub(crate) fn trace_headers(parent: Option<&str>) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    if !headers.contains_key("traceparent")
        && let Some(parent) =
            parent.filter(|parent| hosted_runtimes::domain::telemetry::is_valid_traceparent(parent))
        && let Ok(value) = reqwest::header::HeaderValue::from_str(parent)
    {
        headers.insert("traceparent", value);
    }
    headers
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
    let computer_id = std::fs::read_to_string(crate::computer::ENROLLED_MARKER)
        .ok()
        .and_then(|value| uuid::Uuid::parse_str(value.lines().next()?.trim()).ok());
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
                metadata.name().starts_with("macrod.enroll") || metadata.name() == "run_enroll"
            }))
    });
    // Without a filter the registry logs every dependency at TRACE.
    let stderr = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        );
    tracing_subscriber::registry()
        .with(stderr)
        .with(layer)
        .init();
    Telemetry(provider)
}
