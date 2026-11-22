//! A proxied run's only way out (`Egress::Proxied`): a loopback listener,
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
        dry_run: Option<DryRunReads>,
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
            dry_run,
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
    /// A dry run's reads: the only requests besides GET and HEAD it forwards.
    dry_run: Option<DryRunReads>,
}

/// The catalog's reads that aren't GET or HEAD, each as its service, method
/// and path template, so a dry run's forwarder sends no write however the
/// program's realm was tampered with.
#[derive(Debug, Default)]
pub(crate) struct DryRunReads {
    reads: Vec<(String, String, Vec<Segment>)>,
}

/// Whether a path segment, as sent, is a dot segment or hides a separator
/// once its percent-escapes are decoded.
fn moves_the_path(segment: &str) -> bool {
    let decoded = segment
        .to_ascii_lowercase()
        .replace("%2e", ".")
        .replace("%2f", "/")
        .replace("%5c", "\\");
    decoded == "." || decoded == ".." || decoded.contains(['/', '\\'])
}

#[derive(Debug, PartialEq)]
enum Segment {
    Literal(String),
    /// A `{name}` placeholder: any one non-empty segment.
    Parameter,
}

impl DryRunReads {
    /// From `(service.operation, method, path template, write)` entries.
    pub(crate) fn new<'a>(
        operations: impl IntoIterator<Item = (&'a str, &'a str, &'a str, bool)>,
    ) -> Self {
        let reads = operations
            .into_iter()
            .filter(|(_, _, _, write)| !write)
            .filter_map(|(key, method, path, _)| {
                let (service, _) = key.split_once('.')?;
                let segments = path
                    .trim_start_matches('/')
                    .split('/')
                    .map(|segment| {
                        if segment.starts_with('{') && segment.ends_with('}') {
                            Segment::Parameter
                        } else {
                            Segment::Literal(segment.to_owned())
                        }
                    })
                    .collect();
                Some((service.to_owned(), method.to_owned(), segments))
            })
            .collect();
        Self { reads }
    }

    /// Whether `method` on `path`, under `service`'s base, is a read. The
    /// path is compared as sent, so an encoded or dotted spelling of a
    /// read's path is refused, never taken for it.
    fn allows(&self, service: &str, method: &str, path: &str) -> bool {
        if method == "GET" || method == "HEAD" {
            return true;
        }
        let sent: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        // The upstream URL resolves dot segments, encoded ones too, so a
        // placeholder filled with `..` would send another path than the one
        // matched here.
        if sent.iter().any(|segment| moves_the_path(segment)) {
            return false;
        }
        self.reads
            .iter()
            .any(|(read_service, read_method, segments)| {
                read_service == service
                    && read_method == method
                    && segments.len() == sent.len()
                    && segments
                        .iter()
                        .zip(&sent)
                        .all(|(segment, sent)| match segment {
                            Segment::Literal(literal) => literal == sent,
                            Segment::Parameter => !sent.is_empty(),
                        })
            })
    }
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
    if let Some(reads) = &routes.dry_run
        && !reads.allows(&service, request.method().as_str(), &format!("/{rest}"))
    {
        span.record("outcome", "dry_run_write");
        span.record("status", StatusCode::FORBIDDEN.as_u16());
        return (StatusCode::FORBIDDEN, "A dry run doesn't send changes.").into_response();
    }
    let mut url = format!("{base}/{rest}");
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

#[cfg(test)]
mod test;
