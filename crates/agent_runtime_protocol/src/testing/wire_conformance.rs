//! Interface-conformance tests shared across every [`Transport`] implementation.
//!
//! Each implementation is exercised through the same assertion body, run as
//! an outer `#[test]` per implementation. This is the pattern the transport
//! port exists to enable: swapping [`FakeTransport`] for
//! [`crate::outbound::websocket::WebSocketWire`] costs nothing beyond
//! supplying a different way to observe the transport's counterpart.

use std::future::Future;
use std::sync::Arc;

use serde_json::{Value, json};
use tokio::time::{Duration, timeout};

use crate::domain::channel::pump;
use crate::domain::ports::Transport;
use crate::outbound::websocket::{ServerTransport, client_wire};
use crate::testing::fake_wire::FakeTransport;

/// Interface-conformance assertion shared by every [`Transport`] implementation:
/// a message sent through the connected channel reaches the transport's
/// counterpart. Each implementation supplies its own way to observe that
/// counterpart, since that's the one part a transport port intentionally
/// doesn't model.
///
/// The payload is a JSON object rather than a bare string: every real message
/// on this protocol is a tagged enum or struct, so it is always an object in
/// practice; there is no other reason to prefer an object here now that the
/// wire carries the bare envelope with no outer framing.
async fn asserts_runtime_to_server_delivery<T, F, Fut>(transport: Arc<T>, receive_from_transport: F)
where
    T: Transport<Value, Value> + Send + Sync + 'static,
    F: FnOnce() -> Fut,
    Fut: Future<Output = Value>,
{
    let channel = pump(transport);
    let message = json!({ "event": "system_event" });
    channel.tx.send(message.clone()).unwrap();

    let received = timeout(Duration::from_secs(1), receive_from_transport())
        .await
        .expect("transport should receive the message promptly");
    assert_eq!(received, message);
}

#[tokio::test]
async fn fake_transport_delivers_runtime_to_server_messages() {
    let (transport, mut probe) = FakeTransport::new();
    asserts_runtime_to_server_delivery(
        Arc::new(transport),
        || async move { probe.next_send().await },
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn websocket_transport_delivers_runtime_to_server_messages() {
    let transport: Arc<ServerTransport<Value, Value>> = Arc::new(ServerTransport::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener should bind");
    let address = listener.local_addr().expect("listener address");
    let app = Arc::clone(&transport).into_router();
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app).await.expect("server should run");
    });

    let (stream, _response) = tokio_tungstenite::connect_async(format!("ws://{address}"))
        .await
        .expect("runtime should connect");
    let wire = client_wire::<Value, _>(stream);

    asserts_runtime_to_server_delivery(Arc::new(wire), || async {
        let mut channel = timeout(Duration::from_secs(1), transport.accept())
            .await
            .expect("server accept should not hang")
            .expect("server should accept runtime");
        channel
            .rx
            .recv()
            .await
            .expect("server logical channel should remain open")
    })
    .await;

    server_handle.abort();
}
