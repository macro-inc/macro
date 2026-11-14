//! A listener in front of a service that writes down what it served.
//!
//! The services have no access log, so the requests a scenario causes are
//! observed here: everything sent to a service's address passes through
//! this proxy, which answers what the service answered and tells the
//! scenario's [`Recorder`] the method, path and status. Scenarios, the
//! Gmail emulator's pushes and (through [`crate::tls`]) Outlook's
//! notifications all arrive this way.

use std::net::SocketAddr;

use axum::Router;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::http::header::{CONNECTION, CONTENT_LENGTH, HOST, TRANSFER_ENCODING};
use axum::response::{IntoResponse, Response};
use rootcause::prelude::*;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::evidence::{Recorder, Served};

/// The largest request body the proxy passes on.
const BODY_LIMIT: usize = 64 * 1024 * 1024;

#[derive(Clone)]
struct Upstream {
    service: &'static str,
    url: String,
    http: reqwest::Client,
    recorder: Recorder,
}

/// The running proxy.
pub(crate) struct RecordingProxy {
    address: SocketAddr,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

impl RecordingProxy {
    /// Starts a proxy for `service`, which answers (or will answer) at the
    /// base URL `upstream`.
    pub(crate) async fn start(
        service: &'static str,
        upstream: &str,
        recorder: Recorder,
    ) -> Result<Self, Report> {
        let http = reqwest::Client::builder()
            // A redirect is the service's answer, for the caller to follow.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .context("could not build the recording proxy's HTTP client")?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("could not bind the recording proxy")?;
        let address = listener.local_addr()?;
        let app = Router::new().fallback(relay).with_state(Upstream {
            service,
            url: upstream.trim_end_matches('/').to_owned(),
            http,
            recorder,
        });

        let cancel = CancellationToken::new();
        let tracker = TaskTracker::new();
        let stopped = cancel.clone();
        tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { stopped.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "the recording proxy stopped");
            }
        });

        Ok(Self {
            address,
            cancel,
            tracker,
        })
    }

    /// Where the proxy listens.
    pub(crate) fn address(&self) -> SocketAddr {
        self.address
    }

    /// The proxy's base URL: the service's address, as far as callers know.
    pub(crate) fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    /// Stops the proxy.
    pub(crate) async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

/// A proxy dropped without `stop`, as when a stack fails to start, ends too.
impl Drop for RecordingProxy {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

async fn relay(State(upstream): State<Upstream>, request: Request) -> Response {
    let method = request.method().clone();
    let headers = request.headers().clone();
    let path = request.uri().path().to_owned();
    let query = request.uri().query().map(str::to_owned);
    let Ok(body) = axum::body::to_bytes(request.into_body(), BODY_LIMIT).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };

    let mut url = format!("{}{path}", upstream.url);
    if let Some(query) = &query {
        url.push('?');
        url.push_str(query);
    }
    let mut forwarded = upstream
        .http
        .request(method.clone(), url)
        .body(body.clone());
    for (name, value) in &headers {
        if name != HOST && name != CONTENT_LENGTH {
            forwarded = forwarded.header(name, value);
        }
    }

    // A service that is down answers nothing: neither does the proxy, beyond
    // the status a gateway gives, and nothing was served.
    let Ok(answered) = forwarded.send().await else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    let status = answered.status();
    let answered_headers = answered.headers().clone();
    let Ok(bytes) = answered.bytes().await else {
        return StatusCode::BAD_GATEWAY.into_response();
    };

    upstream.recorder.served(&Served {
        service: upstream.service,
        method: method.as_str(),
        path: &path,
        query: query.as_deref(),
        body: &body,
        status: status.as_u16(),
        answer: &bytes,
    });

    let mut response = Response::new(axum::body::Body::from(bytes));
    *response.status_mut() = status;
    for (name, value) in &answered_headers {
        if name != CONTENT_LENGTH && name != TRANSFER_ENCODING && name != CONNECTION {
            response.headers_mut().append(name, value.clone());
        }
    }
    response
}
