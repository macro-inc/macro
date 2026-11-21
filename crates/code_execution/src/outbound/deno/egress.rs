//! A proxied or enforced run's only way out (`Egress::Proxied`, `Egress::Enforced`): a loopback listener,
//! one per run, that forwards each request to the SDK host it names. The
//! child's `--allow-net` names only this listener, so the code-execution
//! mark and trace context are set here, outside the program's realm, where
//! the program can't rewrite them.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::TryStreamExt;
use opentelemetry::trace::TraceContextExt;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Marks a request as a program's, as the in-realm fetch wrapper does; the
/// same name as `macro_authorization::CODE_EXECUTION_HEADER`.
const CODE_EXECUTION_HEADER: &str = "x-macro-code-execution";

/// One run's forwarder, listening until it is stopped or dropped.
pub(crate) struct RunEgress {
    /// The SDK hosts as the child sees them: each service under this
    /// listener, `http://127.0.0.1:<port>/<service>`.
    pub(crate) hosts: BTreeMap<String, String>,
    task: Option<JoinHandle<()>>,
}

impl RunEgress {
    /// Listen on a fresh loopback port and forward to `hosts`.
    pub(crate) async fn start(
        client: reqwest::Client,
        hosts: &BTreeMap<String, String>,
        trace_headers: &BTreeMap<String, String>,
        policy: RunPolicy,
    ) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        let upstreams = hosts
            .iter()
            .map(|(service, base)| (service.clone(), base.trim_end_matches('/').to_owned()))
            .collect();
        // Each request's span is a child of the run's trusted trace context,
        // so the run stays one trace: the forwarder's tasks inherit no span.
        let carrier: HashMap<String, String> = trace_headers.clone().into_iter().collect();
        let run = opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.extract_with_context(&opentelemetry::Context::new(), &carrier)
        });
        let routes = Arc::new(Routes {
            client,
            upstreams,
            run,
            policy,
        });
        let app = axum::Router::new().fallback(forward).with_state(routes);
        // Owned by the run, not a tracker: it is aborted when the run ends
        // or this is dropped, so it can't outlive the run.
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app).await {
                tracing::warn!(?error, "a run's egress listener failed");
            }
        });
        let hosts = hosts
            .keys()
            .map(|service| {
                (
                    service.clone(),
                    format!("http://127.0.0.1:{port}/{service}"),
                )
            })
            .collect();
        Ok(Self {
            hosts,
            task: Some(task),
        })
    }

    /// Stop listening. A request still in flight ends with its connection:
    /// the child's, which closes when its process is reaped.
    pub(crate) async fn stop(mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
            // An aborted task's error is the abort itself.
            let _ = task.await;
        }
    }
}

impl Drop for RunEgress {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

struct Routes {
    client: reqwest::Client,
    /// Each service's base URL, without a trailing slash.
    upstreams: HashMap<String, String>,
    /// The run's trace context, each request's parent.
    run: opentelemetry::Context,
    /// What the run's requests are held to.
    policy: RunPolicy,
}

/// The SDK's operations, read once for every run's decisions.
static CATALOG: std::sync::LazyLock<decision::Catalog> =
    std::sync::LazyLock::new(decision::Catalog::of_the_sdk);

/// Whether a request carries a Macro credential, wherever one goes: its
/// `authorization` or `x-macro-user-api-key` header, its
/// `macro-access-token` cookie, or its `macro-api-token` query parameter.
fn credentialed(headers: &HeaderMap, url: &url::Url) -> bool {
    headers.contains_key(axum::http::header::AUTHORIZATION)
        || headers.contains_key("x-macro-user-api-key")
        || headers
            .get_all(axum::http::header::COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|cookies| cookies.split(';'))
            .any(|cookie| {
                cookie
                    .trim()
                    .split_once('=')
                    .is_some_and(|(name, _)| name == "macro-access-token")
            })
        || url.query_pairs().any(|(name, _)| name == "macro-api-token")
}

/// The headers of `headers` that cross the forwarder: not the ones that
/// describe one connection (the fixed hop-by-hop set and any `Connection`
/// names), nor the ones the forwarder sets itself.
fn end_to_end(headers: &HeaderMap) -> HeaderMap {
    let nominated: Vec<String> = headers
        .get_all("connection")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|name| name.trim().to_ascii_lowercase())
        .collect();
    let mut kept = HeaderMap::new();
    for (name, value) in headers {
        if forwarded(name) && !nominated.iter().any(|nominated| nominated == name.as_str()) {
            kept.append(name.clone(), value.clone());
        }
    }
    kept
}

/// Headers that describe one connection, not the request, and the ones the
/// forwarder sets itself.
fn forwarded(name: &HeaderName) -> bool {
    !matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "traceparent"
            | "tracestate"
            | CODE_EXECUTION_HEADER
    )
}

async fn forward(State(routes): State<Arc<Routes>>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let (service, rest) = path
        .trim_start_matches('/')
        .split_once('/')
        .map_or((path.trim_start_matches('/'), ""), |(service, rest)| {
            (service, rest)
        });
    let service = service.to_owned();
    let span = tracing::info_span!(
        "code_execution.egress",
        service = %service,
        method = %request.method(),
        status = tracing::field::Empty,
        outcome = tracing::field::Empty,
        operation = tracing::field::Empty,
        uncatalogued = tracing::field::Empty,
        would_refuse = tracing::field::Empty,
        upstream_ms = tracing::field::Empty,
    );
    if routes.run.span().span_context().is_valid() {
        let _ = span.set_parent(routes.run.clone());
    }
    let Some(base) = routes.upstreams.get(&service) else {
        span.record("outcome", "unknown_host");
        span.record("status", StatusCode::NOT_FOUND.as_u16());
        return (StatusCode::NOT_FOUND, "no such SDK host").into_response();
    };
    let mut target = format!("{base}/{rest}");
    if let Some(query) = request.uri().query() {
        target.push('?');
        target.push_str(query);
    }
    // Services under one base take each other's requests.
    let sharing: Vec<&str> = routes
        .upstreams
        .iter()
        .filter(|(_, other)| *other == base)
        .map(|(name, _)| name.as_str())
        .collect();
    // Parsing normalizes the path (`..`, `%2e`), as the host will read it. A
    // URL that won't parse is recorded and sent as it is, failing as it would
    // without the decision.
    let decided = match (url::Url::parse(&target), url::Url::parse(base)) {
        (Ok(url), Ok(base_url)) => decision::decide_across(
            &CATALOG,
            &sharing,
            base_url.path(),
            request.method().as_str(),
            url.path(),
            routes.policy,
            credentialed(request.headers(), &url),
        ),
        _ => decision::Decision {
            operation: None,
            refusal: Some(decision::Refusal::UnparseableUrl),
            uncatalogued: false,
        },
    };
    if let Some(operation) = decided.operation {
        span.record("operation", operation);
        // Services under one base share a forwarder segment: the operation
        // says which one this is.
        if let Some((owner, _)) = operation.split_once('.') {
            span.record("service", owner);
        }
    }
    if decided.uncatalogued {
        span.record("uncatalogued", true);
    }
    if let Some(refusal) = decided.refusal {
        span.record("would_refuse", refusal.as_str());
        // Recorded only, until the run is set to enforce.
        if routes.policy.enforce {
            span.record("outcome", "refused");
            span.record("status", StatusCode::FORBIDDEN.as_u16());
            // The path the host would have seen, not the forwarder's.
            let path = url::Url::parse(&target)
                .map(|url| url.path().to_owned())
                .unwrap_or_else(|_| request.uri().path().to_owned());
            let message = refusal.message(request.method().as_str(), &path);
            return (StatusCode::FORBIDDEN, message).into_response();
        }
    }
    let method = request.method().clone();
    let mut headers = end_to_end(request.headers());
    headers.insert(CODE_EXECUTION_HEADER, HeaderValue::from_static("1"));
    let body = reqwest::Body::wrap_stream(request.into_body().into_data_stream());
    async move {
        macro_tower_layers::inject_trace_headers(&mut headers);
        let started = Instant::now();
        let answer = routes
            .client
            .request(method, target)
            .headers(headers)
            .body(body)
            .send()
            .await;
        let span = tracing::Span::current();
        span.record("upstream_ms", started.elapsed().as_millis() as u64);
        match answer {
            Ok(answer) => {
                span.record("outcome", "forwarded");
                span.record("status", answer.status().as_u16());
                let mut response = Response::builder().status(answer.status());
                for (name, value) in &end_to_end(answer.headers()) {
                    response = response.header(name, value);
                }
                let body = answer.bytes_stream().map_err(std::io::Error::other);
                response
                    .body(Body::from_stream(body))
                    .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
            }
            Err(error) => {
                span.record("outcome", "upstream_error");
                span.record("status", StatusCode::BAD_GATEWAY.as_u16());
                // Without the URL: its query can carry what the program searched for.
                let error = error.without_url();
                tracing::warn!(?error, "an SDK host did not answer a run's request");
                (StatusCode::BAD_GATEWAY, "the SDK host did not answer").into_response()
            }
        }
    }
    .instrument(span)
    .await
}

mod decision;

pub(crate) use decision::RunPolicy;

#[cfg(test)]
mod test;
