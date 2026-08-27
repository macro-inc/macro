use chrono::DateTime;
use serde_json::{Value, json};
use tokio::time::{Duration, timeout};

use super::*;

/// A recorded line the way `record_line` would serialize it.
fn line(direction: &str, content: Value) -> String {
    json!({
        "ts": "2026-08-03T14:22:07.123Z",
        "direction": direction,
        "content": content,
    })
    .to_string()
}

fn shared(line: &str) -> Append {
    Append::Shared(line.to_owned())
}

fn session(session_id: &str, line: &str) -> Append {
    Append::Session {
        session_id: session_id.to_owned(),
        line: line.to_owned(),
    }
}

#[test]
fn session_recording_path_is_sanitized_jsonl_under_dir() {
    assert_eq!(
        session_recording_path(Path::new("/tmp/recordings"), "sess-1"),
        PathBuf::from("/tmp/recordings/sess-1.jsonl"),
    );
    // Path separators in an exotic id cannot escape the directory.
    assert_eq!(
        session_recording_path(Path::new("/tmp/recordings"), "../evil/id"),
        PathBuf::from("/tmp/recordings/.._evil_id.jsonl"),
    );
}

#[test]
fn router_attributes_session_new_to_its_minted_session() {
    let mut router = SessionRouter::default();

    // Connection-level traffic is shared: the readiness event immediately,
    // the initialize pair once its response shows no session was minted.
    let ready = line("to_server", json!({"type": "event", "event": "acp_ready"}));
    assert_eq!(router.route(ready.clone()), vec![shared(&ready)]);
    let init_request = line(
        "to_runtime",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {}}),
    );
    assert_eq!(router.route(init_request.clone()), vec![]);
    let init_response = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 0, "result": {"protocolVersion": 1}}),
    );
    assert_eq!(
        router.route(init_response.clone()),
        vec![shared(&init_request), shared(&init_response)],
    );

    // session/new is buffered until the response mints the session id, then
    // both lines land in that session.
    let new_request = line(
        "to_runtime",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {"cwd": "/"}}),
    );
    assert_eq!(router.route(new_request.clone()), vec![]);
    let new_response = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 1, "result": {"sessionId": "sess-1"}}),
    );
    assert_eq!(
        router.route(new_response.clone()),
        vec![
            session("sess-1", &new_request),
            session("sess-1", &new_response),
        ],
    );

    // Traffic naming the session follows it directly.
    let update = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "sess-1", "update": {}}}),
    );
    assert_eq!(
        router.route(update.clone()),
        vec![session("sess-1", &update)]
    );
}

#[test]
fn router_scopes_request_ids_by_direction() {
    let mut router = SessionRouter::default();

    // Both peers use id 7 concurrently: the client prompts sess-a while the
    // agent asks sess-b for permission.
    let prompt = line(
        "to_runtime",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 7, "method": "session/prompt", "params": {"sessionId": "sess-a", "prompt": []}}),
    );
    assert_eq!(
        router.route(prompt.clone()),
        vec![session("sess-a", &prompt)]
    );
    let permission = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 7, "method": "session/request_permission", "params": {"sessionId": "sess-b"}}),
    );
    assert_eq!(
        router.route(permission.clone()),
        vec![session("sess-b", &permission)],
    );

    // Each response routes to the session of the request it answers.
    let permission_reply = line(
        "to_runtime",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 7, "result": {"outcome": {"outcome": "cancelled"}}}),
    );
    assert_eq!(
        router.route(permission_reply.clone()),
        vec![session("sess-b", &permission_reply)],
    );
    let prompt_reply = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 7, "result": {"stopReason": "end_turn"}}),
    );
    assert_eq!(
        router.route(prompt_reply.clone()),
        vec![session("sess-a", &prompt_reply)],
    );
}

#[test]
fn router_falls_back_to_shared_for_unattributable_lines() {
    let mut router = SessionRouter::default();

    // A notification naming no session, and a response to a request the
    // router never saw, both stay at connection level.
    let notification = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "method": "connection/ping", "params": {}}),
    );
    assert_eq!(
        router.route(notification.clone()),
        vec![shared(&notification)],
    );
    let orphan_response = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 99, "result": {}}),
    );
    assert_eq!(
        router.route(orphan_response.clone()),
        vec![shared(&orphan_response)],
    );
}

#[test]
fn router_drain_recovers_unanswered_requests() {
    let mut router = SessionRouter::default();

    let unanswered = line(
        "to_runtime",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 3, "method": "session/new", "params": {"cwd": "/"}}),
    );
    assert_eq!(router.route(unanswered.clone()), vec![]);
    assert_eq!(router.drain(), vec![shared(&unanswered)]);
    assert_eq!(router.drain(), vec![]);
}

#[tokio::test]
async fn writer_splits_sessions_into_standalone_files() {
    let dir = std::env::temp_dir().join(format!(
        "agent_session_recorder_writer_test_{}",
        std::process::id()
    ));
    let _ = tokio::fs::remove_dir_all(&dir).await;

    let ready = line("to_server", json!({"type": "event", "event": "acp_ready"}));
    let new_a_request = line(
        "to_runtime",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {"cwd": "/"}}),
    );
    let new_a_response = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 1, "result": {"sessionId": "sess-a"}}),
    );
    let update_a = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "sess-a", "update": {}}}),
    );
    let ping = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "method": "connection/ping", "params": {}}),
    );
    let new_b_request = line(
        "to_runtime",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 2, "method": "session/new", "params": {"cwd": "/"}}),
    );
    let new_b_response = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "id": 2, "result": {"sessionId": "sess-b"}}),
    );
    let update_b = line(
        "to_server",
        json!({"type": "acp", "jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "sess-b", "update": {}}}),
    );

    let (sink, lines) = mpsc::unbounded_channel();
    let writer = tokio::spawn(run_writer(dir.clone(), lines));
    for recorded in [
        &ready,
        &new_a_request,
        &new_a_response,
        &update_a,
        &ping,
        &new_b_request,
        &new_b_response,
        &update_b,
    ] {
        sink.send(recorded.clone())
            .expect("writer should be listening");
    }
    drop(sink);
    timeout(Duration::from_secs(5), writer)
        .await
        .expect("writer should stop once the sink drops")
        .expect("writer should not panic")
        .expect("writer should not fail");

    // sess-a was open when the shared ping arrived, so it appears in stream
    // order; sess-b opened later and gets it as part of its shared prefix.
    let recording_a = tokio::fs::read_to_string(session_recording_path(&dir, "sess-a"))
        .await
        .expect("sess-a recording should exist");
    assert_eq!(
        recording_a.lines().collect::<Vec<_>>(),
        vec![&ready, &new_a_request, &new_a_response, &update_a, &ping],
    );
    let recording_b = tokio::fs::read_to_string(session_recording_path(&dir, "sess-b"))
        .await
        .expect("sess-b recording should exist");
    assert_eq!(
        recording_b.lines().collect::<Vec<_>>(),
        vec![&ready, &ping, &new_b_request, &new_b_response, &update_b],
    );

    tokio::fs::remove_dir_all(&dir)
        .await
        .expect("test directory should be removable");
}

#[tokio::test]
async fn tap_records_and_forwards_both_directions() {
    let (inner, mut runtime_side) = Channel::duplex();
    let (sink, mut lines) = mpsc::unbounded_channel();
    let mut tapped = record_channel(inner, sink);

    // Runtime -> service traffic is forwarded and recorded as to_server.
    runtime_side
        .tx
        .send(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        })
        .expect("tap should be listening");
    let forwarded = timeout(Duration::from_secs(1), tapped.rx.recv())
        .await
        .expect("runtime message should be forwarded promptly")
        .expect("tapped channel should stay open");
    assert!(matches!(
        forwarded,
        ToServerMessage::Event {
            event: SystemEvent::AcpReady
        }
    ));

    // Service -> runtime traffic is forwarded and recorded as to_runtime.
    let prompt: ToRuntimeMessage = serde_json::from_value(json!({
        "type": "acp",
        "jsonrpc": "2.0",
        "id": 1,
        "method": "session/prompt",
        "params": { "sessionId": "sess-1", "prompt": [] },
    }))
    .expect("envelope should deserialize");
    tapped.tx.send(prompt).expect("tap should be listening");
    let forwarded = timeout(Duration::from_secs(1), runtime_side.rx.recv())
        .await
        .expect("service message should be forwarded promptly")
        .expect("runtime channel should stay open");
    assert!(matches!(forwarded, ToRuntimeMessage::Acp(_)));

    // Each direction was recorded before it was forwarded, so by the time
    // the forwards above were observed both lines are already in the sink,
    // in send order. Each line is Message's own serialization plus `ts`, so
    // it parses straight back into Message.
    let event_line = lines.recv().await.expect("event line");
    let event_value: Value =
        serde_json::from_str(&event_line).expect("recorded line should be JSON");
    assert_eq!(event_value["direction"], "to_server");
    assert_eq!(
        event_value["content"],
        json!({"type": "event", "event": "acp_ready"})
    );
    DateTime::parse_from_rfc3339(event_value["ts"].as_str().expect("ts should be a string"))
        .expect("ts should be RFC 3339");
    let event_message: Message =
        serde_json::from_str(&event_line).expect("line should parse as Message");
    assert!(matches!(
        event_message,
        Message::ToServer(ToServerMessage::Event {
            event: SystemEvent::AcpReady
        })
    ));

    let prompt_line = lines.recv().await.expect("prompt line");
    let prompt_value: Value =
        serde_json::from_str(&prompt_line).expect("recorded line should be JSON");
    assert_eq!(prompt_value["direction"], "to_runtime");
    assert_eq!(prompt_value["content"]["type"], "acp");
    assert_eq!(prompt_value["content"]["method"], "session/prompt");
    assert_eq!(prompt_value["content"]["params"]["sessionId"], "sess-1");
    let prompt_message: Message =
        serde_json::from_str(&prompt_line).expect("line should parse as Message");
    assert!(matches!(
        prompt_message,
        Message::ToRuntime(ToRuntimeMessage::Acp(_))
    ));
}
