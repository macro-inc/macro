//! Opt-in service/enrollment tracing; stdout remains the daemon protocol.
use hosted_runtimes::domain::ids::ComputerId;
use opentelemetry::trace::TracerProvider;
use opentelemetry_otlp::{WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

macro_env_var::maybe_env_vars! {
    pub struct OtelExporterOtlpEndpoint;
    pub struct OtelExporterOtlpProtocol;
}

/// Where a computer's macrod finds the telemetry settings its enrollment
/// gave: the standard OTel variables, as a systemd environment file that
/// `macrod.service` loads. Root's, like the enrollment marker beside it.
pub const TELEMETRY_ENV: &str = "/var/lib/macrod/telemetry.env";

/// The header a computer names itself in to its telemetry intake, so the
/// intake can limit each computer on its own instead of by the egress IP
/// computers share. Unauthenticated, so the analytics proxy ignores it until
/// the id is signed.
pub const COMPUTER_HEADER: &str = "x-macro-computer-id";

/// How spans leave this process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Exporter {
    /// OTLP over gRPC to this base URL: a collector beside the daemon.
    Grpc(String),
    /// OTLP/HTTP protobuf to a computer's telemetry intake.
    Http {
        /// Base URL; `/v1/traces` is appended.
        endpoint: String,
        /// The computer, sent as [`COMPUTER_HEADER`]. Absent when read from
        /// the environment, whose `OTEL_EXPORTER_OTLP_HEADERS` (written by
        /// [`Exporter::environment_file`]) the exporter reads itself.
        computer: Option<ComputerId>,
    },
}

impl Exporter {
    /// The standard variables: `OTEL_EXPORTER_OTLP_ENDPOINT`, and
    /// `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc` by default, or `http/protobuf`).
    /// None without an endpoint; an unknown protocol fails loudly.
    pub(crate) fn from_environment() -> Option<Self> {
        let endpoint = OtelExporterOtlpEndpoint::new()?.to_string();
        let protocol = OtelExporterOtlpProtocol::new().map(|protocol| protocol.to_string());
        Some(
            Self::parse(endpoint, protocol.as_deref())
                .expect("OTEL_EXPORTER_OTLP_PROTOCOL must be grpc or http/protobuf"),
        )
    }

    fn parse(endpoint: String, protocol: Option<&str>) -> Option<Self> {
        match protocol {
            None | Some("grpc") => Some(Self::Grpc(endpoint)),
            Some("http/protobuf") => Some(Self::Http {
                endpoint,
                computer: None,
            }),
            Some(_) => None,
        }
    }

    /// The `KEY=value` lines [`TELEMETRY_ENV`] holds for this exporter: the
    /// standard variables, with the computer's header in
    /// `OTEL_EXPORTER_OTLP_HEADERS`.
    pub(crate) fn environment_file(&self) -> String {
        let (endpoint, protocol, computer) = match self {
            Self::Grpc(endpoint) => (endpoint, "grpc", None),
            Self::Http { endpoint, computer } => (endpoint, "http/protobuf", computer.as_ref()),
        };
        let headers = computer
            .map(|computer| format!("OTEL_EXPORTER_OTLP_HEADERS={COMPUTER_HEADER}={computer}\n"))
            .unwrap_or_default();
        format!(
            "OTEL_EXPORTER_OTLP_ENDPOINT={endpoint}\nOTEL_EXPORTER_OTLP_PROTOCOL={protocol}\n{headers}"
        )
    }
}

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

pub(crate) fn install(exporter: Option<Exporter>) -> Telemetry {
    let computer_id = std::fs::read_to_string(crate::computer::ENROLLED_MARKER)
        .ok()
        .and_then(|value| uuid::Uuid::parse_str(value.lines().next()?.trim()).ok());
    let provider = exporter.map(|exporter| {
        let exporter = match exporter {
            Exporter::Grpc(endpoint) => opentelemetry_otlp::SpanExporter::builder()
                .with_tonic()
                .with_endpoint(endpoint)
                .build(),
            Exporter::Http { endpoint, computer } => opentelemetry_otlp::SpanExporter::builder()
                .with_http()
                .with_endpoint(format!("{}/v1/traces", endpoint.trim_end_matches('/')))
                .with_headers(
                    computer
                        .map(|computer| (COMPUTER_HEADER.to_owned(), computer.to_string()))
                        .into_iter()
                        .collect(),
                )
                .build(),
        }
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
                metadata.name().starts_with("macrod.enroll")
                    || metadata.name() == "run_enroll"
                    || metadata.name() == "macrod.agent.apply"
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
