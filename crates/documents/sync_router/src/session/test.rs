use super::*;
use bebop::{Record, SliceWrapper};
use futures::{SinkExt, StreamExt};
use sync_service_bebop_schema::{FromRouter, ToRouter};
use tokio::{io::AsyncReadExt, net::TcpListener, sync::oneshot};
use tokio_tungstenite::{accept_async, tungstenite::Message};

fn encode(message: ToRouter<'_>) -> Vec<u8> {
    let mut bytes = Vec::new();
    message.serialize(&mut bytes).unwrap();
    bytes
}

async fn next_frame(receiver: &mut mpsc::Receiver<Vec<u8>>) -> Vec<u8> {
    receiver.recv().await.unwrap()
}

#[tokio::test]
async fn separate_host_sessions_route_the_same_document_without_cross_delivery() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let server = tokio::spawn(async move {
        let (first, _) = listener.accept().await.unwrap();
        let mut first = accept_async(first).await.unwrap();
        let (second, _) = listener.accept().await.unwrap();
        let mut second = accept_async(second).await.unwrap();
        let first_bytes = loop {
            if let Message::Binary(bytes) = first.next().await.unwrap().unwrap() {
                break bytes;
            }
        };
        let second_bytes = loop {
            if let Message::Binary(bytes) = second.next().await.unwrap().unwrap() {
                break bytes;
            }
        };
        assert_eq!(first_bytes.as_ref(), &[0, 11, 12]);
        assert_eq!(second_bytes.as_ref(), &[1, 21, 22]);
        first.send(Message::Binary(first_bytes)).await.unwrap();
        second.send(Message::Binary(second_bytes)).await.unwrap();
        // Session shutdown must drop both downstream sockets.
        let _ = first.next().await;
        let _ = second.next().await;
    });
    let (first_sender, mut first_receiver) = mpsc::channel(10);
    let (second_sender, mut second_receiver) = mpsc::channel(10);
    let first = SyncSessionFactory::new(base_url.clone())
        .unwrap()
        .open("gateway-a/socket-a".into(), first_sender);
    let second = SyncSessionFactory::new(base_url)
        .unwrap()
        .open("gateway-b/socket-b".into(), second_sender);
    first
        .frame(encode(ToRouter::RouterSubscribe {
            doc_id: "same-document",
            token: "first-token",
        }))
        .await
        .unwrap();
    assert!(matches!(
        FromRouter::deserialize(&next_frame(&mut first_receiver).await).unwrap(),
        FromRouter::RouterSubscribed {
            doc_id: "same-document"
        }
    ));
    second
        .frame(encode(ToRouter::RouterSubscribe {
            doc_id: "same-document",
            token: "second-token",
        }))
        .await
        .unwrap();
    assert!(matches!(
        FromRouter::deserialize(&next_frame(&mut second_receiver).await).unwrap(),
        FromRouter::RouterSubscribed {
            doc_id: "same-document"
        }
    ));
    first
        .frame(encode(ToRouter::RouterFrame {
            doc_id: "same-document",
            payload: SliceWrapper::Raw(&[0, 11, 12]),
        }))
        .await
        .unwrap();
    second
        .frame(encode(ToRouter::RouterFrame {
            doc_id: "same-document",
            payload: SliceWrapper::Raw(&[1, 21, 22]),
        }))
        .await
        .unwrap();
    assert_eq!(
        next_frame(&mut first_receiver).await,
        crate::domain::envelope::doc_frame("same-document", &[0, 11, 12])
    );
    assert_eq!(
        next_frame(&mut second_receiver).await,
        crate::domain::envelope::doc_frame("same-document", &[1, 21, 22])
    );
    first.shutdown().await;
    second.shutdown().await;
    server.await.unwrap();
}

#[tokio::test]
async fn closing_a_session_cancels_a_downstream_that_never_completes_its_handshake() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let (accepted, accepted_rx) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        accepted.send(()).unwrap();
        let mut bytes = Vec::new();
        socket.read_to_end(&mut bytes).await.unwrap();
    });
    let (sender, _receiver) = mpsc::channel(10);
    let session = SyncSessionFactory::new(base_url)
        .unwrap()
        .open("socket".into(), sender);
    session
        .frame(encode(ToRouter::RouterSubscribe {
            doc_id: "document",
            token: "token",
        }))
        .await
        .unwrap();
    accepted_rx.await.unwrap();
    session.shutdown().await;
    tokio::time::timeout(std::time::Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn unsubscribe_cancels_a_pending_dial_without_stopping_the_session() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let (accepted, accepted_rx) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        accepted.send(()).unwrap();
        socket.read_to_end(&mut Vec::new()).await.unwrap();
    });
    let (sender, _receiver) = mpsc::channel(10);
    let session = SyncSessionFactory::new(base_url)
        .unwrap()
        .open("socket".into(), sender);
    session
        .frame(encode(ToRouter::RouterSubscribe {
            doc_id: "document",
            token: "token",
        }))
        .await
        .unwrap();
    accepted_rx.await.unwrap();
    session
        .frame(encode(ToRouter::RouterUnsubscribe { doc_id: "document" }))
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), server)
        .await
        .unwrap()
        .unwrap();
    assert!(!session.cancel.is_cancelled());
    session.shutdown().await;
}

#[tokio::test]
async fn full_outbound_queue_cancels_only_its_owner_instead_of_dropping_a_chunk() {
    let (sender, _receiver) = mpsc::channel(1);
    sender.send(vec![]).await.unwrap();
    let cancel = CancellationToken::new();
    let other_cancel = CancellationToken::new();
    let conn = ConnectionId("socket".into());
    let sink = SocketSink {
        connection: conn.clone(),
        sender,
        cancel: cancel.clone(),
    };
    assert!(sink.deliver(&conn, vec![1, 2, 3]).await.is_err());
    assert!(cancel.is_cancelled());
    assert!(!other_cancel.is_cancelled());
}

#[tokio::test]
async fn socket_sink_rejects_frames_addressed_to_another_connection() {
    let (sender, mut receiver) = mpsc::channel(1);
    let cancel = CancellationToken::new();
    let sink = SocketSink {
        connection: ConnectionId("owner".into()),
        sender,
        cancel: cancel.clone(),
    };
    assert!(
        sink.deliver(&ConnectionId("other".into()), vec![1])
            .await
            .is_err()
    );
    assert!(receiver.try_recv().is_err());
    assert!(!cancel.is_cancelled());
}

#[tokio::test]
async fn rejected_document_token_never_opens_a_virtual_socket() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let result = tokio_tungstenite::accept_hdr_async(
            socket,
            |_request: &tokio_tungstenite::tungstenite::handshake::server::Request,
             _response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                Err(tokio_tungstenite::tungstenite::http::Response::builder()
                    .status(401)
                    .body(Some("rejected".into()))
                    .unwrap())
            },
        )
        .await;
        assert!(result.is_err());
    });
    let (sender, mut receiver) = mpsc::channel(10);
    let session = SyncSessionFactory::new(base_url)
        .unwrap()
        .open("socket".into(), sender);
    session
        .frame(encode(ToRouter::RouterSubscribe {
            doc_id: "document",
            token: "invalid-token",
        }))
        .await
        .unwrap();
    assert!(matches!(
        FromRouter::deserialize(&next_frame(&mut receiver).await).unwrap(),
        FromRouter::RouterSubscribeFailed {
            doc_id: "document",
            ..
        }
    ));
    session.shutdown().await;
    server.await.unwrap();
}

#[tokio::test]
async fn scoped_tokens_and_document_ids_cannot_change_the_downstream_url() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let server = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_hdr_async(
            socket,
            |request: &tokio_tungstenite::tungstenite::handshake::server::Request,
             response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                assert_eq!(
                    request.uri().path(),
                    "/document/doc%2Fother%3Foverride/connect"
                );
                let url = Url::parse(&format!("http://localhost{}", request.uri())).unwrap();
                assert_eq!(
                    url.query_pairs().collect::<Vec<_>>(),
                    vec![("token".into(), "scoped&token=secret+value".into())]
                );
                Ok(response)
            },
        )
        .await
        .unwrap();
        let _ = socket.next().await;
    });
    let (sender, mut receiver) = mpsc::channel(10);
    let session = SyncSessionFactory::new(base_url)
        .unwrap()
        .open("socket".into(), sender);
    session
        .frame(encode(ToRouter::RouterSubscribe {
            doc_id: "doc/other?override",
            token: "scoped&token=secret+value",
        }))
        .await
        .unwrap();
    assert!(matches!(
        FromRouter::deserialize(&next_frame(&mut receiver).await).unwrap(),
        FromRouter::RouterSubscribed { .. }
    ));
    session.shutdown().await;
    server.await.unwrap();
}

#[tokio::test]
async fn host_shutdown_cancels_and_waits_for_all_sessions() {
    let factory = SyncSessionFactory::new(Url::parse("http://127.0.0.1:1").unwrap()).unwrap();
    let (sender, _receiver) = mpsc::channel(1);
    let session = factory.open("socket".into(), sender);
    let shutdown = factory.shutdown();
    tokio::pin!(shutdown);
    tokio::select! {
        _ = &mut shutdown => panic!("must wait for socket cleanup"),
        _ = session.closed() => {},
    }
    assert!(!factory.active.is_empty());
    session.shutdown().await;
    tokio::time::timeout(std::time::Duration::from_secs(1), shutdown)
        .await
        .unwrap();
    assert!(factory.active.is_empty());
}

#[tokio::test]
async fn oversized_frames_cannot_enter_client_or_router_queues() {
    let factory = SyncSessionFactory::new(Url::parse("http://127.0.0.1:1").unwrap()).unwrap();
    let (sender, _receiver) = mpsc::channel(1);
    let session = factory.open("socket".into(), sender.clone());
    assert!(session.frame(vec![0; MAX_FRAME_BYTES + 1]).await.is_err());
    let cancel = CancellationToken::new();
    let conn = ConnectionId("socket".into());
    let sink = SocketSink {
        connection: conn.clone(),
        sender,
        cancel: cancel.clone(),
    };
    assert!(
        sink.deliver(&conn, vec![0; MAX_FRAME_BYTES + 1])
            .await
            .is_err()
    );
    assert!(cancel.is_cancelled());
    session.shutdown().await;
}

#[tokio::test]
async fn all_document_queues_share_a_byte_budget_until_writes_finish() {
    use crate::domain::ports::Downstream;
    let budget = Arc::new(tokio::sync::Semaphore::new(10));
    let (first_tx, mut first_rx) = mpsc::channel(8);
    let (second_tx, _second_rx) = mpsc::channel(8);
    let first = Downstream::new(first_tx, CancellationToken::new(), budget.clone());
    let second = Downstream::new(second_tx, CancellationToken::new(), budget.clone());
    first.try_send(vec![0; 6]).unwrap();
    assert!(second.try_send(vec![0; 5]).is_err());
    let in_flight = first_rx.recv().await.unwrap();
    assert!(second.try_send(vec![0; 5]).is_err());
    drop(in_flight);
    second.try_send(vec![0; 10]).unwrap();
    assert_eq!(budget.available_permits(), 0);
}

#[tokio::test]
async fn tls_handshake_failure_is_reported_without_losing_the_downstream_task() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = Url::parse(&format!("https://{}", listener.local_addr().unwrap())).unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        // Receive a TLS handshake record, then reject the connection.
        assert_eq!(socket.read_u8().await.unwrap(), 0x16);
    });
    let (sender, mut receiver) = mpsc::channel(10);
    let session = SyncSessionFactory::new(base_url)
        .unwrap()
        .open("socket".into(), sender);
    session
        .frame(encode(ToRouter::RouterSubscribe {
            doc_id: "document",
            token: "token",
        }))
        .await
        .unwrap();
    let frame = tokio::time::timeout(std::time::Duration::from_secs(2), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        FromRouter::deserialize(&frame).unwrap(),
        FromRouter::RouterSubscribeFailed {
            doc_id: "document",
            ..
        }
    ));
    session.shutdown().await;
    server.await.unwrap();
}
