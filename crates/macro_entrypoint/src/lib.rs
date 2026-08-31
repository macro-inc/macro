#![deny(missing_docs)]
//! This crate provides a standardized initialization process that should be used across entrypoint crates.
//! This is used to provide consistent behaviour with e.g. tracing configurations

mod datadog_fmt;
mod shutdown;

#[cfg(test)]
mod test;

pub use shutdown::shutdown_signal;

use macro_env::Environment;
use macro_env_var::{env_vars, maybe_env_vars};
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::trace::SdkTracerProvider;
use rootcause::hooks::Hooks;
use rootcause_tracing::{RootcauseLayer, SpanCollector};
use tracing_subscriber::{
    EnvFilter, Layer, Registry,
    filter::{FilterExt, LevelFilter},
    layer::SubscriberExt,
    util::SubscriberInitExt,
};
use tracing_tree::HierarchicalLayer;

env_vars! {
    pub struct DdService;
    pub struct DdEnv;
}

maybe_env_vars! {
    pub struct RustLog;
    pub struct OtelExporterOtlpEndpoint;
    pub struct OtelTraceFilter;
}

/// Build an [`EnvFilter`] from `RUST_LOG`, honoring values injected via `APP_SECRETS_JSON`.
///
/// [`EnvFilter::from_default_env`] only reads the process environment, so a `RUST_LOG` set through
/// `APP_SECRETS_JSON` (the way the rest of our config is injected, see `macro_env_var`) is ignored
/// and our tracing filter ends up wrong. This reads `RUST_LOG` the same way `macro_env_var` does —
/// `APP_SECRETS_JSON` first, then the process environment as a fallback.
fn rust_log_env_filter() -> EnvFilter {
    match RustLog::new() {
        Some(value) => EnvFilter::builder().parse_lossy(value),
        None => EnvFilter::from_default_env(),
    }
}

/// Build an [`EnvFilter`] for the OpenTelemetry span exporter from `OTEL_TRACE_FILTER`.
///
/// Traces are filtered independently of `RUST_LOG` so that lowering log verbosity (e.g.
/// `RUST_LOG=warn`) cannot silence APM traces — `#[tracing::instrument]` spans default to INFO
/// and a global filter would drop them before the otel layer sees them. Defaults to `info` when
/// `OTEL_TRACE_FILTER` is unset or contains no valid directives.
fn otel_env_filter() -> EnvFilter {
    otel_trace_filter(OtelTraceFilter::new().as_deref())
}

fn otel_trace_filter(value: Option<&str>) -> EnvFilter {
    EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .parse_lossy(value.unwrap_or(""))
}

fn install_rootcause_hooks() {
    Hooks::new()
        .report_creation_hook(SpanCollector::new())
        .install()
        .expect("failed to install rootcause tracing hooks");
}

/// unit struct which defines the behaviour for instantiation
#[derive(Debug)]
pub struct MacroEntrypoint {
    env: Environment,
    /// describes options that only apply in local dev
    local: LocalOptions,
}

impl Default for MacroEntrypoint {
    fn default() -> Self {
        // Load .env file if it exists, but don't fail if it doesn't
        let _ = dotenvy::dotenv();
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
    logger_provider: Option<SdkLoggerProvider>,
}

impl InitializedEntrypoint {
    /// Gracefully shut down the OpenTelemetry providers.
    /// This should be called before the application exits to ensure all traces and logs are flushed.
    pub fn shutdown(&self) {
        if let Some(ref provider) = self.tracer_provider
            && let Err(e) = provider.shutdown()
        {
            tracing::error!(error=?e, "failed to shutdown tracer provider");
        }
        if let Some(ref provider) = self.logger_provider
            && let Err(e) = provider.shutdown()
        {
            tracing::error!(error=?e, "failed to shutdown logger provider");
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
        let _ = dotenvy::dotenv();
        std::panic::set_hook(Box::new(tracing_panic::panic_hook));
        install_rootcause_hooks();

        match (self.env, self.local) {
            (Environment::Local, LocalOptions { tree_tracing: None }) => {
                let rust_log_filter = rust_log_env_filter();
                // Local OTLP export is opt-in. xtask injects this only for
                // trace-enabled local runs. Alongside spans, tracing events
                // ship as OTLP log records (Loki, when the collector is the
                // LGTM stack), so local logs are queryable next to the traces
                // they belong to.
                let export_otel = OtelExporterOtlpEndpoint::new().is_some();
                let tracer_provider = export_otel.then(|| init_opentelemetry("local".to_string()));
                let logger_provider = export_otel.then(|| init_otel_logs("local".to_string()));

                if let Some(provider) = tracer_provider.as_ref() {
                    let otel_filter = otel_env_filter();
                    let rootcause_filter = rust_log_filter.clone().or(otel_filter.clone());
                    let otel_layer = otel_layer_with_error_mapping(provider.tracer(service_name()))
                        .with_filter(otel_filter);
                    let log_bridge = logger_provider.as_ref().map(|p| {
                        OpenTelemetryTracingBridge::new(p).with_filter(otel_logs_filter())
                    });

                    Registry::default()
                        .with(RootcauseLayer.with_filter(rootcause_filter))
                        .with(
                            tracing_subscriber::fmt::layer()
                                .with_ansi(true)
                                .with_file(true)
                                .with_line_number(true)
                                .pretty()
                                .with_filter(rust_log_filter),
                        )
                        .with(otel_layer)
                        .with(log_bridge)
                        .init();
                } else {
                    Registry::default()
                        .with(RootcauseLayer.with_filter(rust_log_filter.clone()))
                        .with(
                            tracing_subscriber::fmt::layer()
                                .with_ansi(true)
                                .with_file(true)
                                .with_line_number(true)
                                .pretty()
                                .with_filter(rust_log_filter),
                        )
                        .init();
                }

                InitializedEntrypoint {
                    tracer_provider,
                    logger_provider,
                }
            }
            (
                Environment::Local,
                LocalOptions {
                    tree_tracing: Some(level),
                },
            ) => {
                let rust_log_filter = rust_log_env_filter();
                let subscriber = Registry::default()
                    .with(RootcauseLayer.with_filter(rust_log_filter.clone()))
                    .with(HierarchicalLayer::new(level).with_filter(rust_log_filter));
                tracing::subscriber::set_global_default(subscriber).unwrap();
                InitializedEntrypoint {
                    tracer_provider: None,
                    logger_provider: None,
                }
            }
            (Environment::Production | Environment::Develop, _) => {
                // Get environment from DD_ENV
                let env = DdEnv::new()
                    .map(|e| e.to_string())
                    .unwrap_or_else(|_| "unknown".to_string());
                let tracer_provider = init_opentelemetry(env);

                let tracer = tracer_provider.tracer(service_name());
                let rust_log_filter = rust_log_env_filter();
                let otel_filter = otel_env_filter();
                // Capture anything already enabled for logs or OTEL without enabling new callsites.
                let rootcause_filter = rust_log_filter.clone().or(otel_filter.clone());
                let otel_layer = otel_layer_with_error_mapping(tracer).with_filter(otel_filter);

                // Build the JSON event format, then wrap it with DatadogFormat
                // to inject dd.trace_id / dd.span_id for trace-log correlation.
                let json_format = tracing_subscriber::fmt::format::Format::default()
                    .json()
                    .with_current_span(true)
                    .with_span_list(false)
                    .flatten_event(true)
                    .with_file(true)
                    .with_line_number(true);

                let fmt_layer = tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .fmt_fields(tracing_subscriber::fmt::format::JsonFields::new())
                    .event_format(datadog_fmt::DatadogFormat { inner: json_format })
                    .with_filter(rust_log_filter);

                Registry::default()
                    .with(RootcauseLayer.with_filter(rootcause_filter))
                    .with(fmt_layer)
                    .with(otel_layer)
                    .init();

                // Prod/develop logs reach Datadog as JSON on stdout (the fmt
                // layer above); no OTLP log export there.
                InitializedEntrypoint {
                    tracer_provider: Some(tracer_provider),
                    logger_provider: None,
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

/// Default OpenTelemetry export endpoint: the Datadog agent sidecar in prod/develop.
const DEFAULT_OTLP_ENDPOINT: &str = "http://127.0.0.1:4317";

/// Wraps the OTel layer so `tracing::error!` events on a span (e.g.
/// `macro_tower_layers::CustomOnFailure`'s "response failed", or an
/// `#[instrument(err)]` failure) become an OTLP exception with a message and
/// stack trace, and set the span's error status message. Without these, a
/// span can be marked errored (from the HTTP status) with no `error.message`
/// / `error.stack` for Datadog to show — "Missing error message and stack
/// trace" in the UI.
fn otel_layer_with_error_mapping<S>(
    tracer: opentelemetry_sdk::trace::SdkTracer,
) -> tracing_opentelemetry::OpenTelemetryLayer<S, opentelemetry_sdk::trace::SdkTracer>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    tracing_opentelemetry::layer()
        .with_tracer(tracer)
        .with_error_events_to_exceptions(true)
        .with_error_events_to_status(true)
        .with_error_fields_to_exceptions(true)
        .with_error_records_to_exceptions(true)
        .with_location(true)
}

/// The service name reported on traces: `DD_SERVICE` when set, otherwise the
/// current executable's file name so each service is distinguishable locally.
fn service_name() -> String {
    if let Ok(service) = DdService::new() {
        return service.to_string();
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "unknown-service".to_string())
}

fn otel_endpoint() -> String {
    OtelExporterOtlpEndpoint::new()
        .map(|e| e.to_string())
        .unwrap_or_else(|| DEFAULT_OTLP_ENDPOINT.to_string())
}

fn otel_resource(deployment_environment: String) -> opentelemetry_sdk::Resource {
    opentelemetry_sdk::Resource::builder()
        .with_service_name(service_name())
        .with_attribute(opentelemetry::KeyValue::new(
            "deployment.environment",
            deployment_environment,
        ))
        .build()
}

fn init_opentelemetry(deployment_environment: String) -> SdkTracerProvider {
    // W3C trace-context propagation: lets macro_tower_layers parent request
    // spans under an incoming `traceparent` (e.g. from the web app), and
    // service clients propagate context onward.
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(otel_endpoint())
        .build()
        .expect("failed to create OTLP span exporter");

    SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(otel_resource(deployment_environment))
        .build()
}

/// OTLP log export for the [`OpenTelemetryTracingBridge`]: tracing events
/// become log records (with trace/span correlation) at the same endpoint the
/// spans go to. Local-only today — see the prod arm of [`MacroEntrypoint::init`].
fn init_otel_logs(deployment_environment: String) -> SdkLoggerProvider {
    let exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(otel_endpoint())
        .build()
        .expect("failed to create OTLP log exporter");

    SdkLoggerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(otel_resource(deployment_environment))
        .build()
}

/// Filter for the log bridge: mirror `RUST_LOG` verbosity, but never feed the
/// exporter's own internals back into it — the OTel/tonic stack logs through
/// `tracing`, so exporting those events would emit more of them (a
/// telemetry-induced-telemetry loop).
fn otel_logs_filter() -> EnvFilter {
    let mut filter = rust_log_env_filter();
    for directive in [
        "opentelemetry=off",
        "opentelemetry_sdk=off",
        "opentelemetry_otlp=off",
        "tonic=off",
        "h2=off",
        "hyper=off",
    ] {
        filter = filter.add_directive(directive.parse().expect("static directive parses"));
    }
    filter
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
