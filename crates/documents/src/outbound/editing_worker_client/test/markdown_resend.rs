//! Markdown reads and writes over an HTTP/2 connection that is reset under
//! them, as the edge in front of the editing worker resets the one connection
//! every request multiplexes over.

use std::{
    convert::Infallible,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    task::{Context, Poll},
    time::Duration,
};

use bytes::Bytes;
use http_body_util::BodyExt as _;
use hyper::{
    Request, Response, StatusCode,
    body::{Frame, Incoming},
    service::service_fn,
};
use hyper_util::rt::{TokioExecutor, TokioIo};
use tokio::sync::watch;
use tower::retry::budget::TpsBudget;
use transport_failure::TransportFailure;

use super::super::resend::MarkdownResend;
use super::*;
use crate::domain::markdown_body::{DocumentMarkdown, DocumentMarkdownWritten};
use crate::domain::ports::editing::MarkdownWrite;

/// What a faulty connection does to the requests it carries.
#[derive(Clone, Copy)]
enum Fault {
    /// Reset the TCP connection once this many requests wait on it.
    Reset { waiting: usize },
    /// Answer 200, then reset the TCP connection partway through the body,
    /// once the client is reading it.
    CutBody,
}

/// A response body that resets its connection after its bytes when `reset`
/// is set.
struct Reply {
    data: Option<Bytes>,
    reset: Option<Arc<watch::Sender<bool>>>,
}

impl hyper::body::Body for Reply {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        _: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
        if let Some(data) = self.data.take() {
            return Poll::Ready(Some(Ok(Frame::data(data))));
        }
        if let Some(reset) = self.reset.take() {
            reset.send_replace(true);
            return Poll::Pending;
        }
        Poll::Ready(None)
    }
}

struct Worker {
    url: String,
    requests: Arc<AtomicUsize>,
    connections: Arc<AtomicUsize>,
}

/// The worker's answer to `action` with `status`.
fn answer(action: &str, status: StatusCode) -> serde_json::Value {
    match (status, action) {
        (StatusCode::OK, "read") => {
            serde_json::json!({ "action": "read", "markdown": "# Notes", "revision": "r1" })
        }
        (StatusCode::OK, _) => {
            serde_json::json!({ "action": "write", "revision": "r2", "changed": true })
        }
        _ => serde_json::json!({ "error": "The document changed since it was read." }),
    }
}

/// An editing worker over cleartext HTTP/2. Its first `faulty` connections
/// fail with `fault`; the others answer every request with `status`.
async fn worker(fault: Fault, faulty: usize, status: StatusCode) -> Worker {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(AtomicUsize::new(0));
    let connections = Arc::new(AtomicUsize::new(0));
    let (server_requests, server_connections) = (requests.clone(), connections.clone());
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            // Dropping a socket with zero linger sends RST instead of FIN.
            tcp.set_zero_linger().unwrap();
            let faulty = server_connections.fetch_add(1, Ordering::SeqCst) < faulty;
            let requests = server_requests.clone();
            let waiting = Arc::new(AtomicUsize::new(0));
            let (reset_tx, mut reset_rx) = watch::channel(false);
            let reset_tx = Arc::new(reset_tx);
            tokio::spawn(async move {
                let service = service_fn(move |request: Request<Incoming>| {
                    let (requests, waiting, reset_tx) =
                        (requests.clone(), waiting.clone(), reset_tx.clone());
                    async move {
                        let body = request.into_body().collect().await.unwrap().to_bytes();
                        requests.fetch_add(1, Ordering::SeqCst);
                        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
                        let action = body["request"]["action"].as_str().unwrap().to_owned();
                        if faulty && let Fault::Reset { waiting: count } = fault {
                            if waiting.fetch_add(1, Ordering::SeqCst) + 1 == count {
                                reset_tx.send_replace(true);
                            }
                            std::future::pending::<()>().await;
                        }
                        let cut = faulty && matches!(fault, Fault::CutBody);
                        let (status, body) = if cut {
                            // Past the client's 2 MiB HTTP/2 stream window, so the
                            // reset waits for the client to read the body: a reset
                            // arriving with the headers fails the send instead.
                            let padding = "x".repeat(3 * 1024 * 1024);
                            let body = format!(r#"{{"action":"{action}","markdown":"{padding}"#);
                            (StatusCode::OK, body.into_bytes())
                        } else {
                            (status, answer(&action, status).to_string().into_bytes())
                        };
                        let mut response = Response::new(Reply {
                            data: Some(Bytes::from(body)),
                            reset: cut.then_some(reset_tx),
                        });
                        *response.status_mut() = status;
                        Ok::<_, Infallible>(response)
                    }
                });
                let connection = hyper::server::conn::http2::Builder::new(TokioExecutor::new())
                    .serve_connection(TokioIo::new(tcp), service);
                // Returning drops the socket, resetting it under every waiting stream.
                tokio::select! {
                    _ = connection => {}
                    _ = reset_rx.wait_for(|reset| *reset) => {}
                }
            });
        }
    });
    Worker {
        url,
        requests,
        connections,
    }
}

/// Production negotiates HTTP/2 with the edge over TLS; prior knowledge
/// drives the same HTTP/2 client without certificates.
fn client(worker: &Worker) -> ReqwestEditingWorkerClient {
    ReqwestEditingWorkerClient::new(
        worker.url.clone(),
        Arc::new(
            Client::builder()
                .no_proxy()
                .http2_prior_knowledge()
                .build()
                .unwrap(),
        ),
    )
}

fn token() -> DocumentPermissionToken {
    "test-token".to_owned().into()
}

fn read_body() -> DocumentMarkdown {
    DocumentMarkdown {
        markdown: "# Notes".to_owned(),
        revision: "r1".to_owned(),
    }
}

/// The production burst: reads sharing one connection fail together when it
/// is reset, and each lands on a new connection.
#[tokio::test]
async fn reads_sharing_a_reset_connection_are_resent_on_a_new_one() {
    let worker = worker(Fault::Reset { waiting: 3 }, 1, StatusCode::OK).await;
    let client = client(&worker);
    let token = token();

    let (first, second, third) = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(
            client.read_markdown("document-1", &token),
            client.read_markdown("document-2", &token),
            client.read_markdown("document-3", &token),
        )
    })
    .await
    .unwrap();

    assert_eq!(first.unwrap(), read_body());
    assert_eq!(second.unwrap(), read_body());
    assert_eq!(third.unwrap(), read_body());
    assert_eq!(worker.requests.load(Ordering::SeqCst), 6);
    assert_eq!(worker.connections.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_read_cut_off_mid_body_is_resent() {
    let worker = worker(Fault::CutBody, 1, StatusCode::OK).await;

    let read = client(&worker).read_markdown("document-1", &token()).await;

    assert_eq!(read.unwrap(), read_body());
    assert_eq!(worker.requests.load(Ordering::SeqCst), 2);
}

/// A worker whose connection keeps resetting is resent to once, then fails
/// with the transport cause the router reports as 502.
#[tokio::test]
async fn a_connection_reset_on_every_attempt_fails_after_one_resend() {
    let worker = worker(Fault::Reset { waiting: 1 }, usize::MAX, StatusCode::OK).await;

    let error = client(&worker)
        .read_markdown("document-1", &token())
        .await
        .unwrap_err();

    assert_eq!(
        TransportFailure::classify(error.as_ref()),
        TransportFailure::ConnectionClosed
    );
    assert_eq!(worker.requests.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_write_reset_before_its_answer_is_resent() {
    let worker = worker(Fault::Reset { waiting: 1 }, 1, StatusCode::OK).await;

    let write = client(&worker)
        .write_markdown("document-1", &token(), "r1", "# Notes")
        .await
        .unwrap();

    let MarkdownWrite::Written(written) = write else {
        panic!("expected the resent write to land");
    };
    assert_eq!(
        written,
        DocumentMarkdownWritten {
            revision: "r2".to_owned(),
            changed: true,
        }
    );
    assert_eq!(worker.requests.load(Ordering::SeqCst), 2);
}

/// The lost first attempt may be what moved the revision, so a conflict on
/// the resend is an unknown outcome, never "nothing was written".
#[tokio::test]
async fn a_resent_write_that_finds_the_document_changed_reports_an_unknown_outcome() {
    let worker = worker(Fault::Reset { waiting: 1 }, 1, StatusCode::CONFLICT).await;

    let write = client(&worker)
        .write_markdown("document-1", &token(), "r1", "# Notes")
        .await;

    assert!(write.is_err(), "{write:?}");
    assert_eq!(worker.requests.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_conflict_on_the_first_attempt_is_a_conflict() {
    let worker = worker(Fault::CutBody, 0, StatusCode::CONFLICT).await;

    let write = client(&worker)
        .write_markdown("document-1", &token(), "r1", "# Notes")
        .await
        .unwrap();

    assert!(matches!(write, MarkdownWrite::Conflict));
    assert_eq!(worker.requests.load(Ordering::SeqCst), 1);
}

/// A write answered 200 has been committed, even if its body is lost.
#[tokio::test]
async fn a_write_cut_off_after_its_answer_is_not_resent() {
    let worker = worker(Fault::CutBody, 1, StatusCode::OK).await;

    let write = client(&worker)
        .write_markdown("document-1", &token(), "r1", "# Notes")
        .await;

    assert!(write.is_err(), "{write:?}");
    assert_eq!(worker.requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn an_error_status_is_not_resent() {
    let worker = worker(Fault::CutBody, 0, StatusCode::BAD_GATEWAY).await;

    let read = client(&worker).read_markdown("document-1", &token()).await;

    assert!(read.is_err(), "{read:?}");
    assert_eq!(worker.requests.load(Ordering::SeqCst), 1);
}

/// With a budget of one resend per two requests, a worker that resets every
/// connection gets three requests for two reads, not four.
#[tokio::test]
async fn resends_stop_once_the_budget_is_spent() {
    let worker = worker(Fault::Reset { waiting: 1 }, usize::MAX, StatusCode::OK).await;
    let mut client = client(&worker);
    client.markdown_resend =
        MarkdownResend::with_budget(TpsBudget::new(Duration::from_secs(60), 0, 0.5));

    let first = client.read_markdown("document-1", &token()).await;
    assert_eq!(worker.requests.load(Ordering::SeqCst), 1);
    let second = client.read_markdown("document-2", &token()).await;

    assert!(first.is_err() && second.is_err());
    assert_eq!(worker.requests.load(Ordering::SeqCst), 3);
}
