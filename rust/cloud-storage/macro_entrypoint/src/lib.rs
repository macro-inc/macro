#![deny(missing_docs)]
//! This crate provides a standardized initialization process that should be used across entrypoint crates.
//! This is used to provide consistent behaviour with e.g. tracing configurations

use macro_env::Environment;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::{EnvFilter, Registry, layer::SubscriberExt, util::SubscriberInitExt};
use tracing_tree::HierarchicalLayer;

/// unit struct which defines the behaviour for instantiation
#[derive(Debug)]
pub struct MacroEntrypoint {
    env: Environment,
    /// describes options that only apply in local dev
    local: LocalOptions,
}

impl Default for MacroEntrypoint {
    fn default() -> Self {
        MacroEntrypoint {
            env: Environment::new_or_prod(),
            local: Default::default(),
        }
    }
}

/// sentinel struct which guarantees that we called [MacroEntrypoint::init]
#[derive(Debug)]
pub struct InitializedEntrypoint {
    tracer_provider: Option<SdkTracerProvider>,
}

impl InitializedEntrypoint {
    /// Gracefully shut down the OpenTelemetry tracer provider.
    /// This should be called before the application exits to ensure all traces are flushed.
    pub fn shutdown(&self) {
        if let Some(ref provider) = self.tracer_provider
            && let Err(e) = provider.shutdown()
        {
            tracing::error!(error=?e, "failed to shutdown tracer provider");
        }
    }
}

impl MacroEntrypoint {
    /// create a new instance of [Self] from an input [Environment]
    pub fn new(env: Environment) -> Self {
        Self {
            env,
            ..Default::default()
        }
    }

    /// consume self, initialize this binary, and return a proof that it was initialized [InitializedEntrypoint]
    pub fn init(self) -> InitializedEntrypoint {
        // Load .env file if it exists, but don't fail if it doesn't
        let _ = dotenvy::dotenv();
        std::panic::set_hook(Box::new(tracing_panic::panic_hook));

        match (self.env, self.local) {
            (Environment::Local, LocalOptions { tree_tracing: None }) => {
                tracing_subscriber::fmt()
                    .with_ansi(true)
                    // Leaving this commented out to show we explicitly don't want with_env_filter when
                    // running locally. RUST_LOG=trace doesn't work if you use this.
                    // .with_env_filter(EnvFilter::from_default_env())
                    .with_file(true)
                    .with_line_number(true)
                    .pretty()
                    .init();
                InitializedEntrypoint {
                    tracer_provider: None,
                }
            }
            (
                Environment::Local,
                LocalOptions {
                    tree_tracing: Some(level),
                },
            ) => {
                let subscriber = Registry::default().with(HierarchicalLayer::new(level));
                tracing::subscriber::set_global_default(subscriber).unwrap();
                InitializedEntrypoint {
                    tracer_provider: None,
                }
            }
            (Environment::Production | Environment::Develop, _) => {
                let tracer_provider = init_opentelemetry();

                // Get service name for the tracer
                let service_name =
                    std::env::var("DD_SERVICE").unwrap_or_else(|_| "unknown-service".to_string());

                let tracer = tracer_provider.tracer(service_name);
                let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);

                let fmt_layer = tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_file(true)
                    .with_line_number(true)
                    .json()
                    .with_current_span(true)
                    .with_span_list(false)
                    .flatten_event(true);

                Registry::default()
                    .with(EnvFilter::from_default_env())
                    .with(fmt_layer)
                    .with(otel_layer)
                    .init();

                InitializedEntrypoint {
                    tracer_provider: Some(tracer_provider),
                }
            }
        }
    }

    /// begin modifying the options for the local environment
    pub fn local(self) -> LocalOptionsBuilder {
        LocalOptionsBuilder {
            prev: self,
            next: Default::default(),
        }
    }
}

/// Opentelemetry export endpoint to talk with datadog sidecar
const OTEL_EXPORTER_OTLP_ENDPOINT: &str = "http://127.0.0.1:4317";

/// Initialize OpenTelemetry with OTLP exporter to the Datadog agent.
/// The Datadog agent sidecar listens on localhost:4317 for OTLP gRPC.
fn init_opentelemetry() -> SdkTracerProvider {
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(OTEL_EXPORTER_OTLP_ENDPOINT)
        .build()
        .expect("failed to create OTLP span exporter");

    // Get service name from DD_SERVICE or OTEL_SERVICE_NAME
    let service_name =
        std::env::var("DD_SERVICE").unwrap_or_else(|_| "unknown-service".to_string());

    // Get environment from DD_ENV
    let env = std::env::var("DD_ENV").unwrap_or_else(|_| "unknown".to_string());

    let resource = opentelemetry_sdk::Resource::builder()
        .with_service_name(service_name)
        .with_attribute(opentelemetry::KeyValue::new("deployment.environment", env))
        .build();

    SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build()
}

/// builder struct for modifying the local environment options
pub struct LocalOptionsBuilder {
    prev: MacroEntrypoint,
    next: LocalOptions,
}

impl LocalOptionsBuilder {
    /// change the options for tree_tracing
    pub fn tree_tracing(mut self, val: Option<usize>) -> Self {
        self.next.tree_tracing = val;
        self
    }

    /// finish modifying the options for the local environment
    pub fn build(self) -> MacroEntrypoint {
        MacroEntrypoint {
            env: self.prev.env,
            local: self.next,
        }
    }
}

#[derive(Debug, Default)]
struct LocalOptions {
    tree_tracing: Option<usize>,
}
