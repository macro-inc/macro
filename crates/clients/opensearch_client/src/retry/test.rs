use std::{
    convert::Infallible,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    task::{Context, Poll},
    time::Duration,
};

use bytes::Bytes;
use hyper::{
    Request, Response, StatusCode,
    body::{Frame, Incoming},
    service::service_fn,
};
use hyper_util::rt::{TokioExecutor, TokioIo};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use tokio::sync::watch;

use crate::{
    OpensearchClient,
    agent_session::{AgentSessionMessageAuthor, AgentSessionMessageDocument},
    date_format::EpochMillis,
    error::{OpensearchClientError, OpensearchOperation, TransportFailure},
    upsert::{agent_session::ReconcileAgentSessionArgs, email::UpsertEmailArgs},
};

const OK_BODY: &str = r#"{"errors":false,"items":[],"failures":[],"timed_out":false}"#;

/// When the server closes a connection with requests still waiting on it.
#[derive(Clone, Copy)]
enum Close {
    /// Close every connection opened so far once this many requests wait on
    /// them, then answer on new connections: a front end recycling the one
    /// HTTP/2 connection every request multiplexes over.
    OnceWhenWaiting(usize),
    /// Close each connection as soon as a request arrives on it.
    Always,
    /// Reset the first response's stream partway through its body, as a
    /// recycled connection does to a response still in flight.
    CutFirstBody,
    /// Answer every request.
    Never,
}

/// A response body, reset after its bytes when `cut` is set.
struct Reply {
    data: Option<Bytes>,
    cut: bool,
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
        if std::mem::take(&mut self.cut) {
            return Poll::Ready(Some(Err(std::io::ErrorKind::ConnectionReset.into())));
        }
        Poll::Ready(None)
    }
}

struct Server {
    url: String,
    requests: Arc<AtomicUsize>,
    connections: Arc<AtomicUsize>,
}

/// HTTP/2 over TLS, which reqwest negotiates with the OpenSearch domain.
async fn server(close: Close, status: StatusCode) -> Server {
    let certs = include_bytes!("../../../../../infra/local/certs/localhost.pem");
    let key = include_bytes!("../../../../../infra/local/certs/localhost-key.pem");
    let mut config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        CertificateDer::pem_slice_iter(certs)
            .collect::<Result<_, _>>()
            .unwrap(),
        PrivateKeyDer::from_pem_slice(key).unwrap(),
    )
    .unwrap();
    config.alpn_protocols = vec![b"h2".to_vec()];
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "https://localhost:{}",
        listener.local_addr().unwrap().port()
    );

    let requests = Arc::new(AtomicUsize::new(0));
    let connections = Arc::new(AtomicUsize::new(0));
    let waiting = Arc::new(AtomicUsize::new(0));
    let cut_pending = Arc::new(AtomicBool::new(true));
    let (closed_tx, closed_rx) = watch::channel(false);
    let closed_tx = Arc::new(closed_tx);
    let (server_requests, server_connections) = (requests.clone(), connections.clone());
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let tls = acceptor.accept(tcp).await.unwrap();
            server_connections.fetch_add(1, Ordering::SeqCst);
            let holds = match close {
                Close::OnceWhenWaiting(_) => !*closed_rx.borrow(),
                Close::Always => true,
                Close::CutFirstBody | Close::Never => false,
            };
            let (requests, waiting, closed_tx, cut_pending) = (
                server_requests.clone(),
                waiting.clone(),
                closed_tx.clone(),
                cut_pending.clone(),
            );
            let (arrived_tx, mut arrived_rx) = watch::channel(false);
            let mut closed_rx = closed_rx.clone();
            tokio::spawn(async move {
                let service = service_fn(move |_: Request<Incoming>| {
                    requests.fetch_add(1, Ordering::SeqCst);
                    let cut = matches!(close, Close::CutFirstBody)
                        && cut_pending.swap(false, Ordering::SeqCst);
                    let (waiting, closed_tx, arrived_tx) =
                        (waiting.clone(), closed_tx.clone(), arrived_tx.clone());
                    async move {
                        if holds {
                            arrived_tx.send_replace(true);
                            if let Close::OnceWhenWaiting(count) = close
                                && waiting.fetch_add(1, Ordering::SeqCst) + 1 == count
                            {
                                closed_tx.send_replace(true);
                            }
                            std::future::pending::<()>().await;
                        }
                        let body = if cut {
                            &OK_BODY[..OK_BODY.len() / 2]
                        } else {
                            OK_BODY
                        };
                        let mut response = Response::new(Reply {
                            data: Some(Bytes::from_static(body.as_bytes())),
                            cut,
                        });
                        *response.status_mut() = status;
                        Ok::<_, Infallible>(response)
                    }
                });
                let connection = hyper::server::conn::http2::Builder::new(TokioExecutor::new())
                    .serve_connection(TokioIo::new(tls), service);
                // Returning drops the connection, closing it under every waiting stream.
                let close_signal = async {
                    match close {
                        Close::OnceWhenWaiting(_) if holds => {
                            let _ = closed_rx.wait_for(|closed| *closed).await;
                        }
                        Close::Always => {
                            let _ = arrived_rx.wait_for(|arrived| *arrived).await;
                        }
                        _ => std::future::pending().await,
                    }
                };
                tokio::select! {
                    _ = connection => {}
                    () = close_signal => {}
                }
            });
        }
    });
    Server {
        url,
        requests,
        connections,
    }
}

fn client(server: &Server) -> OpensearchClient {
    OpensearchClient::new(server.url.clone(), "".into(), "".into()).unwrap()
}

fn session(id: &str) -> ReconcileAgentSessionArgs {
    ReconcileAgentSessionArgs {
        agent_session_id: id.to_owned(),
        name: "Investigate indexing".to_owned(),
        owner_id: "user-1".to_owned(),
        bot_id: "bot-1".to_owned(),
        thread_id: None,
        originating_message_id: None,
        created_at_millis: EpochMillis::new(10).unwrap(),
        updated_at_millis: EpochMillis::new(20).unwrap(),
        projection_generation: "generation-1".to_owned(),
        messages: vec![AgentSessionMessageDocument {
            turn: 1,
            author: AgentSessionMessageAuthor::Agent,
            author_user_id: None,
            content: "Folded output".to_owned(),
        }],
    }
}

fn email(message_id: &str) -> UpsertEmailArgs {
    UpsertEmailArgs {
        thread_id: "thread-1".to_owned(),
        message_id: message_id.to_owned(),
        sender: "sender@example.com".to_owned(),
        sender_name: None,
        reply_to: None,
        recipients: vec![],
        recipient_names: vec![],
        cc: vec![],
        cc_names: vec![],
        bcc: vec![],
        bcc_names: vec![],
        labels: vec![],
        link_id: "link-1".to_owned(),
        user_id: "user-1".to_owned(),
        updated_at_millis: EpochMillis::new(20).unwrap(),
        subject: None,
        sent_at_millis: None,
        content: "Body".to_owned(),
        properties: vec![],
    }
}

/// The production burst: unrelated agent-session and email writes share one
/// connection, it closes under all of them at once, and each must still land.
#[tokio::test]
async fn writes_sharing_a_closed_connection_are_resent_on_a_new_one() {
    let server = server(Close::OnceWhenWaiting(4), StatusCode::OK).await;
    let client = client(&server);
    let (first_session, second_session) = (session("session-1"), session("session-2"));
    let (first_email, second_email) = ([email("message-1")], [email("message-2")]);

    let results = tokio::time::timeout(Duration::from_secs(20), async {
        tokio::join!(
            client.reconcile_agent_session(&first_session, None),
            client.reconcile_agent_session(&second_session, None),
            client.bulk_upsert_email_messages(&first_email, None),
            client.bulk_upsert_email_messages(&second_email, None),
        )
    })
    .await
    .unwrap();

    results.0.unwrap();
    results.1.unwrap();
    results.2.unwrap();
    results.3.unwrap();
    // Four first attempts lost, then each reconcile's parent, bulk, and prune
    // plus each email bulk on a fresh connection.
    assert_eq!(server.requests.load(Ordering::SeqCst), 4 + 3 * 2 + 2);
    assert!(server.connections.load(Ordering::SeqCst) >= 2);
}

/// A response cut off partway through its body is resent, not reported as
/// an undecodable body.
#[tokio::test]
async fn a_response_cut_off_mid_body_is_resent() {
    let server = server(Close::CutFirstBody, StatusCode::OK).await;
    let messages = [email("message-1")];

    let result = tokio::time::timeout(
        Duration::from_secs(20),
        client(&server).bulk_upsert_email_messages(&messages, None),
    )
    .await
    .unwrap();

    result.unwrap();
    assert_eq!(server.requests.load(Ordering::SeqCst), 2);
}

/// A domain that keeps dropping connections still surfaces as a failure.
#[tokio::test]
async fn a_connection_lost_on_every_attempt_fails_after_three_attempts() {
    let server = server(Close::Always, StatusCode::OK).await;
    let messages = [email("message-1")];

    let result = tokio::time::timeout(
        Duration::from_secs(20),
        client(&server).bulk_upsert_email_messages(&messages, None),
    )
    .await
    .unwrap();

    let Err(OpensearchClientError::RequestFailed {
        cause, operation, ..
    }) = result
    else {
        panic!("expected a lost connection, got {result:?}");
    };
    assert_eq!(cause, TransportFailure::ConnectionClosed);
    assert_eq!(operation, OpensearchOperation::BulkUpsertEmailMessages);
    assert_eq!(server.requests.load(Ordering::SeqCst), 3);
}

/// An answered request is never resent, so a server error stays visible.
#[tokio::test]
async fn an_error_response_is_not_resent() {
    let server = server(Close::Never, StatusCode::SERVICE_UNAVAILABLE).await;
    let messages = [email("message-1")];

    let result = client(&server)
        .bulk_upsert_email_messages(&messages, None)
        .await;

    assert!(
        matches!(
            result,
            Err(OpensearchClientError::Unknown {
                operation: OpensearchOperation::BulkUpsertEmailMessages,
                ..
            })
        ),
        "{result:?}"
    );
    assert_eq!(server.requests.load(Ordering::SeqCst), 1);
}
