//! Hand-written boundary fakes for caller tests of all three execution modes.
use crate::{LexicalClient, RawDocumentSource};
use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::IntoResponse,
};
use serde_json::Value;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

/// Stored editor state with an authored block identity and text.
pub const HELLO_DOCUMENT: &str = r#"{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"$":{"id":"block-one"},"children":[{"type":"text","version":1,"text":"Hello","format":0,"mode":"normal","style":"","detail":0}],"direction":null,"format":"","indent":0}],"direction":null,"format":"","indent":0}}"#;

/// Requests observed by the retained HTTP boundary, including the typed body.
#[derive(Clone, Debug)]
pub struct Request {
    /// HTTP method.
    pub method: String,
    /// Path and query, without the host or credential.
    pub path: String,
    /// JSON request body, or null for a bodyless request.
    pub body: Value,
}
struct Source {
    raw: String,
    reads: AtomicUsize,
}
#[async_trait::async_trait]
impl RawDocumentSource for Source {
    async fn get_raw(&self, _: &str) -> anyhow::Result<String> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        anyhow::ensure!(!self.raw.is_empty(), "unexpected document source read");
        Ok(self.raw.clone())
    }
}
struct HttpState {
    routes: Vec<(String, String, Value)>,
    requests: Mutex<Vec<Request>>,
}
async fn respond(
    State(state): State<Arc<HttpState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> axum::response::Response {
    if headers
        .get("x-internal-auth-key")
        .and_then(|key| key.to_str().ok())
        != Some("test-key")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let path = uri
        .path_and_query()
        .map(|path| path.as_str())
        .unwrap_or("/");
    let body = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(body) => body,
            Err(_) => return StatusCode::BAD_REQUEST.into_response(),
        }
    };
    state.requests.lock().expect("request lock").push(Request {
        method: method.to_string(),
        path: path.into(),
        body,
    });
    match state
        .routes
        .iter()
        .find(|(verb, route, _)| verb == method.as_str() && route == path)
    {
        Some((_, _, value)) => Json(value.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
/// A local HTTP server and independent raw-document fake. Responses are authored
/// by each caller test, never computed with the implementation being compared.
pub struct FakeLexical {
    url: String,
    source: Arc<Source>,
    http: Arc<HttpState>,
    server: tokio::task::JoinHandle<()>,
}
impl FakeLexical {
    /// Serve exactly the supplied method/path/JSON triples on an ephemeral port.
    pub async fn new(raw: &str, routes: Vec<(&str, &str, Value)>) -> Self {
        let http = Arc::new(HttpState {
            routes: routes
                .into_iter()
                .map(|(method, path, body)| (method.into(), path.into(), body))
                .collect(),
            requests: Mutex::default(),
        });
        let app = Router::new().fallback(respond).with_state(http.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener");
        let url = format!("http://{}", listener.local_addr().expect("test address"));
        let server =
            tokio::spawn(
                async move { axum::serve(listener, app).await.expect("test HTTP server") },
            );
        Self {
            url,
            source: Arc::new(Source {
                raw: raw.into(),
                reads: AtomicUsize::new(0),
            }),
            http,
            server,
        }
    }
    /// Construct the actual facade with the caller's explicit mode configuration.
    pub fn client(&self, modes: &str) -> LexicalClient {
        LexicalClient::new("test-key".into(), self.url.clone())
            .with_route_modes(modes.parse().expect("test modes"))
            .with_document_source(self.source.clone())
    }
    /// Inspect only this server's calls.
    pub fn requests(&self) -> Vec<Request> {
        self.http.requests.lock().expect("request lock").clone()
    }
    /// Independent count of local model source reads.
    pub fn raw_reads(&self) -> usize {
        self.source.reads.load(Ordering::SeqCst)
    }
    /// Local boundary URL for a caller that also needs a sync transport.
    pub fn url(&self) -> &str {
        &self.url
    }
}
impl Drop for FakeLexical {
    fn drop(&mut self) {
        self.server.abort();
    }
}

/// The real isolated-stack transports, configured through the same startup
/// sources as production. Only opt-in local integration tests use this type.
pub struct LocalStack {
    /// Route-configured facade with the real live document source.
    pub lexical: LexicalClient,
    /// Real sync transport for initialization and round-trip reads.
    pub sync: sync_service_client::SyncServiceClient,
}
#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct LocalStackConfig {
    environment: macro_service_urls::macro_env::Environment,
    internal_api_secret_key: String,
    sync_service_auth_key: String,
    lexical_route_modes: crate::RouteModes,
}
impl LocalStack {
    /// Read explicit test credentials/modes and typed local service URLs.
    pub fn load() -> anyhow::Result<Self> {
        let config: LocalStackConfig = macro_config::ConfigLoader::load()?;
        anyhow::ensure!(
            matches!(
                config.environment,
                macro_service_urls::macro_env::Environment::Local
            ),
            "local-stack probes require the local environment"
        );
        let sync_url = macro_service_urls::SyncServiceUrl::new()?.to_string();
        let lexical_url = macro_service_urls::LexicalServiceUrl::new()?.to_string();
        for url in [&sync_url, &lexical_url] {
            let url = macro_service_urls::Url::parse(url)?;
            let local = url.host_str().is_some_and(|host| {
                host == "localhost"
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            });
            anyhow::ensure!(local, "local-stack probes require loopback service URLs");
        }
        let sync =
            sync_service_client::SyncServiceClient::new(config.sync_service_auth_key, sync_url);
        let lexical = LexicalClient::new(config.internal_api_secret_key, lexical_url)
            .with_route_modes(config.lexical_route_modes)
            .with_document_source(Arc::new(sync.clone()));
        Ok(Self { lexical, sync })
    }
}

/// Export one actual caller flow to a local OTLP collector, retaining the trace
/// ID for an exact Tempo lookup. The collector endpoint uses OTLP configuration.
pub async fn trace_local<T>(
    name: &'static str,
    flow: impl std::future::Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<(T, String)> {
    use opentelemetry::trace::{TraceContextExt, TracerProvider};
    use tracing::{Instrument, instrument::WithSubscriber};
    use tracing_opentelemetry::OpenTelemetrySpanExt;
    use tracing_subscriber::prelude::*;
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .build()?;
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            opentelemetry_sdk::Resource::builder_empty()
                .with_service_name("lexical-route-caller-local")
                .build(),
        )
        .build();
    let subscriber = tracing_subscriber::registry().with(
        tracing_opentelemetry::layer().with_tracer(provider.tracer("lexical-route-caller-local")),
    );
    let result = async {
        let span = tracing::info_span!("lexical.caller_local", caller = name);
        let trace_id = span.context().span().span_context().trace_id().to_string();
        let output = flow.instrument(span).await?;
        Ok::<_, anyhow::Error>((output, trace_id))
    }
    .with_subscriber(subscriber)
    .await;
    provider.force_flush()?;
    provider.shutdown()?;
    result
}
