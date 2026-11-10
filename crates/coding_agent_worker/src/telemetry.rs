//! Opt-in service/enrollment tracing; stdout remains the daemon protocol.
use opentelemetry::trace::TracerProvider;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

macro_env_var::maybe_env_vars! { pub struct OtelExporterOtlpEndpoint; }

pub(crate) const PROVISION_PARENT_PATH: &str = "/var/lib/macrod/provision.traceparent";
/// The provision parent, only for a daemon started soon after enrollment.
static SETUP_PARENT: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
/// A daemon started this long after enrollment is a restart, not first setup.
const SETUP_WINDOW: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// Whether a daemon starting at `now` is still part of first setup.
fn within_setup(enrolled_at: std::time::SystemTime, now: std::time::SystemTime) -> bool {
    now.duration_since(enrolled_at)
        .is_ok_and(|age| age < SETUP_WINDOW)
}

/// The setup trace while this daemon is part of first setup; its first
/// capability report joins it so the control plane sees when setup finished.
pub(crate) fn setup_parent() -> Option<&'static str> {
    SETUP_PARENT.get().and_then(|value| value.as_deref())
}

/// Trace headers from the current span, or the raw setup parent when this
/// daemon exports no spans of its own, so the server still joins the trace.
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
    let parent = std::fs::read_to_string(PROVISION_PARENT_PATH)
        .ok()
        .map(|value| value.trim().to_owned());
    let enrolled_at = std::fs::metadata(crate::capabilities::ENROLLED_MARKER)
        .and_then(|metadata| metadata.modified())
        .ok();
    let _ =
        SETUP_PARENT.set(parent.filter(|_| {
            enrolled_at.is_some_and(|at| within_setup(at, std::time::SystemTime::now()))
        }));
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
                metadata.name().starts_with("macrod.enroll")
                    || metadata.name() == "macrod.capabilities.report"
                    || metadata.name() == "run_enroll"
            }))
    });
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(layer)
        .init();
    Telemetry(provider)
}

#[cfg(test)]
mod test {
    use super::*;
    use std::time::{Duration, SystemTime};

    #[test]
    fn only_a_daemon_started_soon_after_enrollment_joins_setup() {
        let enrolled = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        assert!(within_setup(enrolled, enrolled + Duration::from_secs(90)));
        assert!(!within_setup(
            enrolled,
            enrolled + Duration::from_secs(2 * 60 * 60)
        ));
        assert!(!within_setup(enrolled, enrolled - Duration::from_secs(1)));
    }

    #[test]
    fn requests_carry_the_setup_parent_when_no_span_is_exported() {
        let parent = "00-11111111111111111111111111111111-2222222222222222-01";
        assert_eq!(
            trace_headers(Some(parent))
                .get("traceparent")
                .and_then(|value| value.to_str().ok()),
            Some(parent)
        );
        assert!(
            trace_headers(Some("not-a-parent"))
                .get("traceparent")
                .is_none()
        );
        assert!(trace_headers(None).get("traceparent").is_none());
    }
}
