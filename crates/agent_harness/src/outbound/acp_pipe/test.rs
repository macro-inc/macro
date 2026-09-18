use super::*;

fn acp(frame: serde_json::Value) -> ToRuntimeMessage {
    ToRuntimeMessage::Acp(AcpMessage(
        serde_json::from_value(frame).expect("valid acp frame"),
    ))
}

/// The first inbound message must be AcpReady, before anything the agent
/// says — the session machine starts its handshake on it.
#[tokio::test]
async fn acp_ready_arrives_before_any_agent_frame() {
    let (ours, theirs) = tokio::io::duplex(4096);
    let (_, mut agent_writer) = tokio::io::split(theirs);
    agent_writer
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n")
        .await
        .expect("write");

    let (_sender, mut receiver) = PipeTransport::connect(ours).split();
    let first = receiver.recv().await.expect("a message");
    assert!(matches!(
        first,
        ToServerMessage::Event {
            event: SystemEvent::AcpReady
        }
    ));
    let second = receiver.recv().await.expect("a message");
    assert!(matches!(second, ToServerMessage::Acp(_)));
}

/// Outbound ACP frames leave as single lines; non-ACP runtime messages are
/// dropped without failing the send.
#[tokio::test]
async fn sends_frames_as_lines_and_drops_what_the_pipe_cannot_carry() {
    let (ours, theirs) = tokio::io::duplex(4096);
    let (agent_reader, _agent_writer) = tokio::io::split(theirs);
    let mut lines = BufReader::new(agent_reader).lines();

    let (sender, _receiver) = PipeTransport::connect(ours).split();
    sender
        .send(acp(serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}
        })))
        .await
        .expect("acp frame sends");
    let line = lines
        .next_line()
        .await
        .expect("read")
        .expect("a line arrives");
    let frame: serde_json::Value = serde_json::from_str(&line).expect("valid json line");
    assert_eq!(frame["method"], "initialize");
}

/// EOF on the pipe ends the inbound stream instead of hanging the receiver.
#[tokio::test]
async fn a_closed_pipe_ends_the_inbound_stream() {
    let (ours, theirs) = tokio::io::duplex(4096);
    let (_sender, mut receiver) = PipeTransport::connect(ours).split();
    receiver.recv().await.expect("acp ready arrives");

    drop(theirs);
    assert!(receiver.recv().await.is_none());
}
