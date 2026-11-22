//! A proxied run's only way out (`Egress::Proxied`): a loopback listener,
//! one per run, that forwards each request to the SDK host it names. The
//! child's `--allow-net` names only this listener, so the code-execution
//! mark and trace context are set here, outside the program's realm, where
//! the program can't rewrite them.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
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
    /// The forwarder's lifetime span (`code_execution.egress_forwarder`):
    /// its outcome at start, and what it proxied once it stops.
    span: tracing::Span,
    counts: Arc<Counts>,
}

/// What a forwarder proxied, for its rollout to be observable.
#[derive(Default)]
struct Counts {
    forwarded: AtomicU64,
    refused: AtomicU64,
    failed: AtomicU64,
}

impl RunEgress {
    /// Listen on a fresh loopback port and forward to `hosts`.
    pub(crate) async fn start(
        client: reqwest::Client,
        hosts: &BTreeMap<String, String>,
        trace_headers: &BTreeMap<String, String>,
    ) -> std::io::Result<Self> {
        let span = tracing::info_span!(
            "code_execution.egress_forwarder",
            hosts = hosts.len(),
            outcome = tracing::field::Empty,
            forwarded = tracing::field::Empty,
            refused = tracing::field::Empty,
            failed = tracing::field::Empty,
            listener = tracing::field::Empty,
        );
        let bound = async {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
            let port = listener.local_addr()?.port();
            std::io::Result::Ok((listener, port))
        }
        .instrument(span.clone())
        .await;
        let (listener, port) = match bound {
            Ok(bound) => bound,
            Err(error) => {
                span.record("outcome", "failed");
                tracing::error!(parent: &span, ?error, "a run's egress forwarder could not start");
                return Err(error);
            }
        };
        span.record("outcome", "ready");
        let counts = Arc::new(Counts::default());
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
            counts: counts.clone(),
        });
        let app = axum::Router::new().fallback(forward).with_state(routes);
        // Owned by the run, not a tracker: it is aborted when the run ends
        // or this is dropped, so it can't outlive the run.
        let listening = span.clone();
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app).await {
                listening.record("listener", "failed");
                tracing::error!(parent: &listening, ?error, "a run's egress listener failed");
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
            span,
            counts,
        })
    }

    /// Record what the forwarder proxied on its span.
    fn record_counts(&self) {
        self.span
            .record("forwarded", self.counts.forwarded.load(Ordering::Relaxed));
        self.span
            .record("refused", self.counts.refused.load(Ordering::Relaxed));
        self.span
            .record("failed", self.counts.failed.load(Ordering::Relaxed));
    }

    /// Stop listening. A request still in flight ends with its connection:
    /// the child's, which closes when its process is reaped.
    pub(crate) async fn stop(mut self) {
        self.record_counts();
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
            self.record_counts();
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
    counts: Arc<Counts>,
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

/// `rest` under the host's `base`, or `None` when it could leave it: a dot
/// segment, a backslash, or an encoded dot, slash or backslash, which the
/// URL parser or a gateway would resolve to another service on the same
/// origin (unfurl among them, which takes no credential).
fn confined(base: &str, rest: &str) -> Option<String> {
    let lower = rest.to_ascii_lowercase();
    if lower.contains('\\')
        || ["%2e", "%2f", "%5c"]
            .iter()
            .any(|encoded| lower.contains(encoded))
    {
        return None;
    }
    if rest
        .split('/')
        .any(|segment| segment == "." || segment == "..")
    {
        return None;
    }
    Some(format!("{base}/{rest}"))
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
        upstream_ms = tracing::field::Empty,
    );
    if routes.run.span().span_context().is_valid() {
        let _ = span.set_parent(routes.run.clone());
    }
    let Some(base) = routes.upstreams.get(&service) else {
        routes.counts.refused.fetch_add(1, Ordering::Relaxed);
        span.record("outcome", "unknown_host");
        span.record("status", StatusCode::NOT_FOUND.as_u16());
        return (StatusCode::NOT_FOUND, "no such SDK host").into_response();
    };
    let Some(mut url) = confined(base, rest) else {
        routes.counts.refused.fetch_add(1, Ordering::Relaxed);
        span.record("outcome", "outside_host");
        span.record("status", StatusCode::BAD_REQUEST.as_u16());
        return (StatusCode::BAD_REQUEST, "the path leaves its SDK host").into_response();
    };
    if let Some(query) = request.uri().query() {
        url.push('?');
        url.push_str(query);
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
            .request(method, url)
            .headers(headers)
            .body(body)
            .send()
            .await;
        let span = tracing::Span::current();
        span.record("upstream_ms", started.elapsed().as_millis() as u64);
        match answer {
            Ok(answer) => {
                routes.counts.forwarded.fetch_add(1, Ordering::Relaxed);
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
                routes.counts.failed.fetch_add(1, Ordering::Relaxed);
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

#[cfg(test)]
mod test;
