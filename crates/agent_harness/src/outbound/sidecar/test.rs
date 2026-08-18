use agent_client_protocol::schema::v1::{PromptRequest, RequestId, SessionId};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::net::{TcpListener, TcpStream};

use super::*;

/// One ACP frame built from the protocol's typed request.
fn frame() -> RawJsonRpcMessage {
    let (method, params) = PromptRequest::new(SessionId::new("acp-test"), vec!["hello".into()])
        .to_untyped_message()
        .expect("the typed request should convert to an ACP message")
        .into_parts();
    RawJsonRpcMessage::request(method, params, RequestId::Number(1))
        .expect("typed request params should produce a valid ACP frame")
}

/// Stand in for the sidecar: accept one WebSocket and hand back the transport
/// under test alongside the sidecar's end of it.
type Halves = (SidecarSender, mpsc::UnboundedReceiver<ToServerMessage>);

async fn transport() -> (Halves, WebSocketStream<TcpStream>) {
    observed_transport(|| {}).await
}

async fn observed_transport<Observer>(observer: Observer) -> (Halves, WebSocketStream<TcpStream>)
where
    Observer: Fn() + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("binding a local port should succeed");
    let address = listener
        .local_addr()
        .expect("a bound listener should have an address");

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("the client should connect");
        tokio_tungstenite::accept_async(stream)
            .await
            .expect("the upgrade should succeed")
    });

    let (client, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
        .await
        .expect("dialing the sidecar should succeed");
    let sidecar = server.await.expect("the accept task should not panic");

    (
        SidecarTransport::connect_observed(client, observer).split(),
        sidecar,
    )
}

#[tokio::test]
async fn reports_acp_ready_before_anything_else() {
    let ((_outbound, mut inbound), mut sidecar) = transport().await;

    // The agent speaks immediately, so this also proves ordering: the frame was
    // on the wire before the first `recv`, and `AcpReady` still comes first.
    let json = serde_json::to_string(&frame()).expect("the fixture should serialize");
    sidecar
        .send(Message::Text(json.into()))
        .await
        .expect("the sidecar should be able to send");

    let first = inbound.recv().await.expect("the stream should be open");
    assert!(matches!(
        first,
        ToServerMessage::Event {
            event: SystemEvent::AcpReady
        }
    ));
}

#[tokio::test]
async fn wraps_frames_from_the_agent() {
    let ((_outbound, mut inbound), mut sidecar) = transport().await;
    let _ready = inbound.recv().await;

    let json = serde_json::to_string(&frame()).expect("the fixture should serialize");
    sidecar
        .send(Message::Text(json.into()))
        .await
        .expect("the sidecar should be able to send");

    let message = inbound.recv().await.expect("the stream should be open");
    let ToServerMessage::Acp(AcpMessage(received)) = message else {
        panic!("an agent frame should arrive as an acp message");
    };
    assert_eq!(
        serde_json::to_value(received).expect("the frame should serialize"),
        serde_json::to_value(frame()).expect("the fixture should serialize"),
    );
}

#[tokio::test]
async fn observes_valid_inbound_acp_frames() {
    let observed = Arc::new(AtomicUsize::new(0));
    let incremented = observed.clone();
    let ((_outbound, mut inbound), mut sidecar) = observed_transport(move || {
        incremented.fetch_add(1, Ordering::Relaxed);
    })
    .await;
    let _ready = inbound.recv().await;

    sidecar
        .send(Message::Text("not json at all".into()))
        .await
        .expect("the sidecar should be able to send");
    let json = serde_json::to_string(&frame()).expect("the fixture should serialize");
    sidecar
        .send(Message::Text(json.into()))
        .await
        .expect("the sidecar should be able to send");
    let _frame = inbound.recv().await;

    assert_eq!(observed.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn unwraps_frames_to_the_agent_without_a_newline() {
    let ((outbound, _inbound), mut sidecar) = transport().await;

    outbound
        .send(ToRuntimeMessage::Acp(AcpMessage(frame())))
        .await
        .expect("sending should succeed");

    let sent = sidecar
        .next()
        .await
        .expect("the sidecar should receive a frame")
        .expect("the frame should not be an error");
    let Message::Text(text) = sent else {
        panic!("frames should go out as text");
    };
    // The sidecar appends the newline to the agent's stdin itself; adding one
    // here puts a blank line into stdin after every frame.
    assert!(!text.ends_with('\n'), "frames must not carry a newline");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).expect("the frame should be json"),
        serde_json::to_value(frame()).expect("the fixture should serialize"),
    );
}

#[tokio::test]
async fn survives_a_frame_it_cannot_parse() {
    let ((_outbound, mut inbound), mut sidecar) = transport().await;
    let _ready = inbound.recv().await;

    sidecar
        .send(Message::Text("not json at all".into()))
        .await
        .expect("the sidecar should be able to send");
    let json = serde_json::to_string(&frame()).expect("the fixture should serialize");
    sidecar
        .send(Message::Text(json.into()))
        .await
        .expect("the sidecar should be able to send");

    let message = inbound
        .recv()
        .await
        .expect("one bad frame should not close the stream");
    assert!(matches!(message, ToServerMessage::Acp(_)));
}

#[tokio::test]
async fn ends_when_the_sidecar_goes_away() {
    let ((_outbound, mut inbound), sidecar) = transport().await;
    let _ready = inbound.recv().await;

    drop(sidecar);

    assert!(inbound.recv().await.is_none());
}

#[tokio::test]
async fn sending_fails_after_the_sidecar_goes_away() {
    let ((outbound, mut inbound), sidecar) = transport().await;
    let _ready = inbound.recv().await;
    drop(sidecar);
    let _closed = inbound.recv().await;

    let error = outbound
        .send(ToRuntimeMessage::Acp(AcpMessage(frame())))
        .await
        .expect_err("a closed socket cannot accept a frame");

    assert!(matches!(error, TransportError::Client(_)));
}
