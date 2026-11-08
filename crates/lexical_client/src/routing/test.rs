use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

struct FakeBackend {
    calls: AtomicUsize,
    text: &'static str,
    fail: bool,
}
impl FakeBackend {
    async fn execute(&self) -> Result<String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            anyhow::bail!("fake backend failed");
        }
        Ok(self.text.to_owned())
    }
}
#[test]
fn configuration_is_strict_and_unspecified_groups_stay_http() {
    let modes: RouteModes = "markdown=in_process,snapshot=shadow"
        .parse()
        .expect("valid modes");
    assert_eq!(modes.mode(RouteGroup::Markdown), RouteMode::InProcess);
    assert_eq!(modes.mode(RouteGroup::Snapshot), RouteMode::Shadow);
    assert_eq!(modes.mode(RouteGroup::Composers), RouteMode::Http);
    assert_eq!(modes.mode(RouteGroup::Html), RouteMode::Http);
    assert!("".parse::<RouteModes>().is_ok());
    assert!(
        "markdown=http,markdown=shadow"
            .parse::<RouteModes>()
            .is_err()
    );
    assert!("markdown=remote".parse::<RouteModes>().is_err());
    assert!("gate=shadow".parse::<RouteModes>().is_err());
    assert!("markdown=http,".parse::<RouteModes>().is_err());
    assert!(serde_json::from_value::<LexicalClientConfig>(serde_json::json!({})).is_err());
    let config: LexicalClientConfig = serde_json::from_value(serde_json::json!({"LEXICAL_ROUTE_MODES":"markdown=http,snapshot=http,composers=http,html=http"})).expect("config");
    assert_eq!(config.lexical_route_modes, RouteModes::default());
}
#[tokio::test]
async fn http_calls_only_http_and_returns_its_result() -> Result<()> {
    let http = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "http",
        fail: false,
    };
    let local = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "local",
        fail: true,
    };
    let result = dispatch(
        RouteMode::Http,
        Route::Markdown,
        Some("document-test"),
        0,
        http.execute(),
        local.execute(),
    )
    .await?;
    assert_eq!(result, "http");
    assert_eq!(http.calls.load(Ordering::SeqCst), 1);
    assert_eq!(local.calls.load(Ordering::SeqCst), 0);
    Ok(())
}
#[tokio::test]
async fn in_process_calls_only_local_and_does_not_fall_back_on_error() -> Result<()> {
    let http = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "http",
        fail: false,
    };
    let local = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "local",
        fail: false,
    };
    let result = dispatch(
        RouteMode::InProcess,
        Route::Mentions,
        None,
        10,
        http.execute(),
        local.execute(),
    )
    .await?;
    assert_eq!(result, "local");
    assert_eq!(http.calls.load(Ordering::SeqCst), 0);
    assert_eq!(local.calls.load(Ordering::SeqCst), 1);
    let error = dispatch(
        RouteMode::InProcess,
        Route::Mentions,
        None,
        10,
        http.execute(),
        unavailable::<String>("mentions"),
    )
    .await
    .expect_err("not ported");
    assert_eq!(
        error
            .downcast_ref::<NotYetPorted>()
            .expect("typed error")
            .route,
        "mentions"
    );
    assert_eq!(http.calls.load(Ordering::SeqCst), 0);
    Ok(())
}
#[tokio::test]
async fn shadow_runs_both_and_keeps_http_success_despite_local_failure() -> Result<()> {
    let http = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "http",
        fail: false,
    };
    let local = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "local",
        fail: false,
    };
    let result = dispatch(
        RouteMode::Shadow,
        Route::Html,
        None,
        4,
        http.execute(),
        local.execute(),
    )
    .await?;
    assert_eq!(result, "http");
    assert_eq!(http.calls.load(Ordering::SeqCst), 1);
    assert_eq!(local.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        dispatch(
            RouteMode::Shadow,
            Route::Html,
            None,
            4,
            http.execute(),
            unavailable::<String>("html")
        )
        .await?,
        "http"
    );
    Ok(())
}
#[tokio::test]
async fn shadow_runs_local_even_when_http_fails_and_returns_http_error() {
    let http = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "http",
        fail: true,
    };
    let local = FakeBackend {
        calls: AtomicUsize::new(0),
        text: "local",
        fail: false,
    };
    let error = dispatch(
        RouteMode::Shadow,
        Route::Search,
        Some("document-test"),
        0,
        http.execute(),
        local.execute(),
    )
    .await
    .expect_err("HTTP failure");
    assert_eq!(error.to_string(), "fake backend failed");
    assert_eq!(local.calls.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn public_client_rejects_unported_mode_without_http_access() {
    let client = crate::LexicalClient::new("test-key".into(), "http://127.0.0.1:1".into())
        .with_route_modes("markdown=in_process".parse().expect("modes"));
    let error = client
        .get_markdown(
            "document-test",
            crate::parse_markdown::MarkdownTarget::Internal,
        )
        .await
        .expect_err("not ported");
    assert_eq!(
        error
            .downcast_ref::<NotYetPorted>()
            .expect("typed error")
            .route,
        "markdown"
    );
}

#[test]
fn comparison_masks_only_exact_generated_await_ids_in_composers() {
    let http =
        Ok(r#"<m-await>{"awaitId":"abcdefghijklmnopqrstu","text":"pending"}</m-await>"#.to_owned());
    let local =
        Ok(r#"<m-await>{"awaitId":"ABCDEFGHIJKLMNOPQ_-01","text":"pending"}</m-await>"#.to_owned());
    assert_eq!(
        comparable(&http, RouteGroup::Composers),
        comparable(&local, RouteGroup::Composers)
    );
    assert_ne!(
        comparable(&http, RouteGroup::Markdown),
        comparable(&local, RouteGroup::Markdown)
    );
    for id in [
        "abcdefghijklmnopqrst",
        "abcdefghijklmnopqrstuv",
        "abcdefghijklmnopqrst!",
        "abcdefghijklmnopqrsté",
        "<generated>",
    ] {
        let invalid = Ok(format!(
            r#"<m-await>{{"awaitId":"{id}","text":"pending"}}</m-await>"#
        ));
        assert_ne!(
            comparable(&http, RouteGroup::Composers),
            comparable(&invalid, RouteGroup::Composers)
        );
    }
    let changed = Ok(
        r#"<m-await>{"awaitId":"ABCDEFGHIJKLMNOPQ_-01","text":"different"}</m-await>"#.to_owned(),
    );
    assert_ne!(
        comparable(&http, RouteGroup::Composers),
        comparable(&changed, RouteGroup::Composers)
    );
}

#[derive(Clone, Default)]
struct TraceBuffer(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
impl std::io::Write for TraceBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .expect("trace buffer")
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn shadow_trace_stays_under_request_and_contains_metadata_only() -> Result<()> {
    let buffer = TraceBuffer::default();
    let writer = buffer.clone();
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::CLOSE)
        .with_writer(move || writer.clone())
        .finish();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    tracing::subscriber::with_default(subscriber, || {
        runtime.block_on(async {
            let parent = tracing::info_span!("caller.request");
            dispatch(
                RouteMode::Shadow,
                Route::Search,
                Some("document-test"),
                42,
                async { Ok("private HTTP content".to_owned()) },
                unavailable::<String>("search"),
            )
            .instrument(parent)
            .await
        })
    })?;
    let output = String::from_utf8(buffer.0.lock().expect("trace buffer").clone())?;
    assert!(!output.contains("private HTTP content"));
    let records: Vec<serde_json::Value> = output
        .lines()
        .map(serde_json::from_str)
        .collect::<std::result::Result<_, _>>()?;
    let mismatch = records
        .iter()
        .find(|line| line["fields"]["message"] == "lexical shadow mismatch")
        .unwrap_or_else(|| panic!("missing mismatch event in {output}"));
    let parents: Vec<_> = mismatch["spans"]
        .as_array()
        .expect("span context")
        .iter()
        .map(|span| span["name"].as_str().expect("name"))
        .collect();
    assert_eq!(
        parents,
        ["caller.request", "lexical.search", "lexical.shadow"]
    );
    let route = records
        .iter()
        .find(|line| {
            line["span"]["name"] == "lexical.search" && line["fields"]["message"] == "close"
        })
        .expect("route close");
    assert_eq!(route["span"]["bytes_in"], 42);
    assert_eq!(route["span"]["bytes_out"], 22);
    assert_eq!(route["span"]["outcome"], "ok");
    let shadow = records
        .iter()
        .find(|line| {
            line["span"]["name"] == "lexical.shadow" && line["fields"]["message"] == "close"
        })
        .expect("shadow close");
    assert_eq!(shadow["span"]["equal"], false);
    assert_eq!(shadow["span"]["error.kind"], "not_yet_ported");
    assert_eq!(shadow["span"]["document_id"], "document-test");
    Ok(())
}

/// Opt-in integration probe; requires the local OTLP collector and Tempo.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires local OTLP on localhost:4317 and Tempo on localhost:3200"]
async fn local_tempo_route_trace() -> Result<()> {
    use opentelemetry::trace::{TraceContextExt, TracerProvider};
    use opentelemetry_otlp::WithExportConfig;
    use tracing::instrument::WithSubscriber;
    use tracing_opentelemetry::OpenTelemetrySpanExt;
    use tracing_subscriber::prelude::*;

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint("http://localhost:4317")
        .build()?;
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            opentelemetry_sdk::Resource::builder_empty()
                .with_service_name("lexical-route-switch-probe")
                .build(),
        )
        .build();
    let subscriber = tracing_subscriber::registry().with(
        tracing_opentelemetry::layer().with_tracer(provider.tracer("lexical-route-switch-probe")),
    );
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path("/markdown/document-probe"))
        .and(wiremock::matchers::header_exists("traceparent"))
        .respond_with(
            wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({"data":"probe"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let url = server.uri();
    let trace_id = async {
        let parent = tracing::info_span!("caller.request");
        let trace_id = parent
            .context()
            .span()
            .span_context()
            .trace_id()
            .to_string();
        let client = crate::LexicalClient::new("probe-key".into(), url)
            .with_route_modes("markdown=shadow".parse()?);
        let result = client
            .get_markdown(
                "document-probe",
                crate::parse_markdown::MarkdownTarget::Internal,
            )
            .instrument(parent)
            .await?;
        assert_eq!(result, "probe");
        Ok::<_, anyhow::Error>(trace_id)
    }
    .with_subscriber(subscriber)
    .await?;
    server.verify().await;
    provider.force_flush()?;
    provider.shutdown()?;
    println!("local Tempo trace: {trace_id}");
    Ok(())
}
