use agent_client_protocol::RawJsonRpcMessage;
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::time::{Duration, timeout};

use super::*;
use crate::domain::connection::{RuntimeConnection, ServerConnection, SystemEventHandler};
use crate::domain::schema::v0::{AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage};

/// A generous cap on waits that should resolve "promptly": long enough that CI
/// scheduling jitter under parallel tests never trips it, short enough that a
/// genuine hang still fails the test rather than stalling the suite. These
/// tests bind real loopback sockets, so a tight 1s raced the runner under load.
const PROMPT: Duration = Duration::from_secs(10);

fn event() -> ToServerMessage {
    ToServerMessage::Event {
        event: SystemEvent::Unknown("runtime/ready".to_owned()),
    }
}

fn acp_to_runtime() -> ToRuntimeMessage {
    ToRuntimeMessage::Acp(AcpMessage(
        RawJsonRpcMessage::notification("session/update".to_owned(), json!({ "foo": "bar" }))
            .unwrap(),
    ))
}

#[tokio::test]
async fn sent_payload_is_exactly_the_serialized_envelope_with_no_rpc_wrapper() {
    let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<String>();
    let wire: WebSocketWire<()> = WebSocketWire {
        outgoing: outgoing_tx,
        incoming: mpsc::unbounded_channel().1,
    };
    let (sender, _receiver) = Transport::<ToRuntimeMessage, ()>::split(wire);

    sender
        .send(acp_to_runtime())
        .await
        .expect("send should succeed");

    let sent = timeout(PROMPT, outgoing_rx.recv())
        .await
        .expect("outbound payload should not hang")
        .expect("outgoing channel should remain open");
    let sent: Value = serde_json::from_str(&sent).unwrap();
    assert_eq!(
        sent,
        json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "foo": "bar" },
        })
    );
    assert!(
        sent.get("id").is_none(),
        "the wire payload must be the bare envelope, not a JSON-RPC-wrapped message"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn wire_frames_are_bare_json_with_no_outer_envelope() {
    let transport: Arc<ServerTransport<ToRuntimeMessage, ToServerMessage>> =
        Arc::new(ServerTransport::new());
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
        .expect("raw client should connect");
    let (mut write, mut read) = stream.split();

    let server_channel = timeout(PROMPT, transport.accept())
        .await
        .expect("server accept should not hang")
        .expect("server should accept the connection");
    server_channel.tx.send(acp_to_runtime()).unwrap();

    // Skip keepalive control frames: the server pings connected runtimes, so a
    // Ping can arrive before (or interleave with) the data frame this asserts
    // on. Read until the first Text frame rather than assuming it is first.
    let text = loop {
        let frame = timeout(PROMPT, read.next())
            .await
            .expect("frame should arrive promptly")
            .expect("stream should remain open")
            .expect("frame should not be an error");
        match frame {
            TungsteniteMessage::Text(text) => break text,
            TungsteniteMessage::Ping(_) | TungsteniteMessage::Pong(_) => continue,
            other => panic!("expected a text frame, got {other:?}"),
        }
    };
    let received: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        received,
        json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "foo": "bar" },
        })
    );

    let raw_reply = serde_json::to_string(&event()).unwrap();
    write
        .send(TungsteniteMessage::Text(raw_reply.into()))
        .await
        .unwrap();
    drop(write);
    server_handle.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn malformed_frame_is_dropped_without_closing_the_connection() {
    let transport: Arc<ServerTransport<ToRuntimeMessage, ToServerMessage>> =
        Arc::new(ServerTransport::new());
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
        .expect("raw client should connect");
    let (mut write, _read) = stream.split();

    let mut server_channel = timeout(PROMPT, transport.accept())
        .await
        .expect("server accept should not hang")
        .expect("server should accept the connection");

    write
        .send(TungsteniteMessage::Text("not json".into()))
        .await
        .unwrap();
    write
        .send(TungsteniteMessage::Text(
            serde_json::to_string(&event()).unwrap().into(),
        ))
        .await
        .unwrap();

    let delivered = timeout(PROMPT, server_channel.rx.recv())
        .await
        .expect("well-formed frame after a malformed one should still arrive")
        .expect("channel should remain open");
    assert_eq!(
        serde_json::to_value(delivered).unwrap(),
        serde_json::to_value(event()).unwrap()
    );

    server_handle.abort();
}

#[tokio::test(flavor = "multi_thread")]
async fn runtime_initiates_a_real_websocket_and_exchanges_bare_json_envelopes() {
    let transport: Arc<ServerTransport<ToRuntimeMessage, ToServerMessage>> =
        Arc::new(ServerTransport::new());
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
    let mut runtime = connect_runtime::<ToServerMessage, ToRuntimeMessage, _>(stream);
    let mut server = timeout(PROMPT, transport.accept())
        .await
        .expect("server accept should not hang")
        .expect("server should accept runtime");

    runtime.tx.send(event()).unwrap();
    let delivered = timeout(PROMPT, server.rx.recv())
        .await
        .expect("runtime-to-server should not hang")
        .expect("server logical channel should remain open");
    assert_eq!(
        serde_json::to_value(delivered).unwrap(),
        serde_json::to_value(event()).unwrap()
    );

    server.tx.send(acp_to_runtime()).unwrap();
    let delivered = timeout(PROMPT, runtime.rx.recv())
        .await
        .expect("server-to-runtime should not hang")
        .expect("runtime logical channel should remain open");
    assert_eq!(
        serde_json::to_value(delivered).unwrap(),
        serde_json::to_value(acp_to_runtime()).unwrap()
    );

    server_handle.abort();
}

struct Events(tokio::sync::mpsc::UnboundedSender<SystemEvent>);

impl SystemEventHandler for Events {
    async fn handle(&self, event: SystemEvent) {
        self.0
            .send(event)
            .expect("event receiver should remain open");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn role_connections_run_over_a_runtime_initiated_websocket() {
    let transport: Arc<ServerTransport<ToRuntimeMessage, ToServerMessage>> =
        Arc::new(ServerTransport::new());
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
    let runtime_channel = connect_runtime::<ToServerMessage, ToRuntimeMessage, _>(stream);
    let server_channel = transport.accept().await.unwrap();
    let (event_sender, mut event_receiver) = tokio::sync::mpsc::unbounded_channel();
    let (_server_connection, _server_acp) =
        ServerConnection::connect(server_channel, Events(event_sender));
    let (runtime_connection, _runtime_acp) = RuntimeConnection::connect(runtime_channel);

    runtime_connection
        .system_event(SystemEvent::Unknown("runtime/ready".to_owned()))
        .unwrap();
    let received = timeout(PROMPT, event_receiver.recv())
        .await
        .expect("event should not hang")
        .expect("event channel should remain open");
    assert_eq!(received, SystemEvent::Unknown("runtime/ready".to_owned()));

    server_handle.abort();
}

/// A socket that accepts everything written to it and never says anything
/// back: the half-open connection this pump's pings exist to catch, where
/// writes keep succeeding into a peer that will never answer again.
struct StalledSocket {
    sent: futures::channel::mpsc::UnboundedSender<TungsteniteMessage>,
}

impl futures::Sink<TungsteniteMessage> for StalledSocket {
    type Error = futures::channel::mpsc::SendError;

    fn poll_ready(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::pin::Pin::new(&mut self.get_mut().sent).poll_ready(context)
    }

    fn start_send(
        self: std::pin::Pin<&mut Self>,
        item: TungsteniteMessage,
    ) -> Result<(), Self::Error> {
        std::pin::Pin::new(&mut self.get_mut().sent).start_send(item)
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::pin::Pin::new(&mut self.get_mut().sent).poll_flush(context)
    }

    fn poll_close(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        std::pin::Pin::new(&mut self.get_mut().sent).poll_close(context)
    }
}

impl futures::Stream for StalledSocket {
    type Item = Result<TungsteniteMessage, futures::channel::mpsc::SendError>;

    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        _context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::task::Poll::Pending
    }
}

#[tokio::test(start_paused = true)]
async fn an_idle_socket_is_pinged_rather_than_left_to_rot() {
    let (sent, mut frames) = futures::channel::mpsc::unbounded();
    let (_outgoing, outgoing_rx) = mpsc::unbounded_channel();
    let (incoming, _incoming_rx) = mpsc::unbounded_channel::<ToServerMessage>();
    tokio::spawn(run_pump(StalledSocket { sent }, outgoing_rx, incoming));

    // Nothing has been asked of this connection, which is exactly when a
    // dead one used to go unnoticed.
    tokio::time::sleep(PING_INTERVAL + Duration::from_millis(100)).await;

    let first = frames.next().await.expect("the pump should ping");
    assert!(
        matches!(first, TungsteniteMessage::Ping(_)),
        "an idle pump's first frame should be a ping, got {first:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_socket_that_stops_answering_pings_is_closed() {
    let (sent, _frames) = futures::channel::mpsc::unbounded();
    let (_outgoing, outgoing_rx) = mpsc::unbounded_channel();
    let (incoming, mut incoming_rx) = mpsc::unbounded_channel::<ToServerMessage>();
    tokio::spawn(run_pump(StalledSocket { sent }, outgoing_rx, incoming));

    // The pump dropping its sender is what every layer above reads as the
    // connection ending, so awaiting that is awaiting the teardown itself -
    // no polling for a state change.
    let ended = timeout(SILENCE_TIMEOUT * 2, incoming_rx.recv())
        .await
        .expect("a silent socket should be given up on, not waited on forever");
    assert!(
        ended.is_none(),
        "the pump should close its inbound channel when the peer goes quiet"
    );
}
