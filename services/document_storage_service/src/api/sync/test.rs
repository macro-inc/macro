use super::*;
use bebop::{Record, SliceWrapper};
use futures::{SinkExt, StreamExt};
use sync_service_bebop_schema::{FromRouter, ToRouter};
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, connect_async, tungstenite::Message as WsMessage};

#[tokio::test]
async fn dedicated_endpoint_preserves_large_chunks_heartbeats_and_drains_on_shutdown() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let factory = SyncSessionFactory::new(
        format!("http://{}", upstream.local_addr().unwrap())
            .parse()
            .unwrap(),
    )
    .unwrap();
    let downstream = tokio::spawn(async move {
        let (socket, _) = upstream.accept().await.unwrap();
        let mut socket = accept_async(socket).await.unwrap();
        while let Some(Ok(message)) = socket.next().await {
            if let WsMessage::Binary(bytes) = message {
                socket.send(WsMessage::Binary(bytes)).await.unwrap();
            }
        }
    });
    // Authentication is exercised separately against the deployed route. This
    // mounts the same upgrade/IO adapter with a session already authorized.
    let host = factory.clone();
    let app = Router::new().route(
        "/sync/ws",
        get(move |upgrade: WebSocketUpgrade| async move { upgrade_session(upgrade, &host, None) }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let (mut client, _) = connect_async(format!("ws://{address}/sync/ws"))
        .await
        .unwrap();
    client.send(WsMessage::Text("ping".into())).await.unwrap();
    assert_eq!(
        client.next().await.unwrap().unwrap(),
        WsMessage::Text("pong".into())
    );
    let mut subscribe = Vec::new();
    ToRouter::RouterSubscribe {
        doc_id: "document",
        token: "scoped-token",
    }
    .serialize(&mut subscribe)
    .unwrap();
    client
        .send(WsMessage::Binary(subscribe.into()))
        .await
        .unwrap();
    let ack = client.next().await.unwrap().unwrap().into_data();
    assert!(matches!(
        FromRouter::deserialize(&ack).unwrap(),
        FromRouter::RouterSubscribed { .. }
    ));
    let chunk = vec![1; 900_001];
    let mut frame = Vec::new();
    ToRouter::RouterFrame {
        doc_id: "document",
        payload: SliceWrapper::Raw(&chunk),
    }
    .serialize(&mut frame)
    .unwrap();
    client.send(WsMessage::Binary(frame.into())).await.unwrap();
    let response = client.next().await.unwrap().unwrap().into_data();
    assert_eq!(
        response.as_ref(),
        sync_router::domain::envelope::doc_frame("document", &chunk)
    );
    tokio::time::timeout(Duration::from_secs(2), factory.shutdown())
        .await
        .unwrap();
    assert!(matches!(
        client.next().await,
        Some(Ok(WsMessage::Close(_))) | None
    ));
    downstream.await.unwrap();
    server.abort();
}

#[tokio::test]
async fn oversized_websocket_message_closes_only_that_session() {
    let factory = SyncSessionFactory::new("http://127.0.0.1:1".parse().unwrap()).unwrap();
    let host = factory.clone();
    let app = Router::new().route(
        "/sync/ws",
        get(move |upgrade: WebSocketUpgrade| async move { upgrade_session(upgrade, &host, None) }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let (mut client, _) = connect_async(format!("ws://{address}/sync/ws"))
        .await
        .unwrap();
    let (mut other, _) = connect_async(format!("ws://{address}/sync/ws"))
        .await
        .unwrap();
    client
        .send(WsMessage::Binary(vec![0; MAX_FRAME_BYTES + 1].into()))
        .await
        .unwrap();
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(2), client.next())
            .await
            .unwrap(),
        Some(Ok(WsMessage::Close(_))) | Some(Err(_)) | None
    ));
    other.send(WsMessage::Text("ping".into())).await.unwrap();
    assert_eq!(
        other.next().await.unwrap().unwrap(),
        WsMessage::Text("pong".into())
    );
    factory.shutdown().await;
    server.abort();
}
