//! Tests for the JSON-RPC dispatch layer, and for [`serve`] over a transport
//! that is not stdio.
//!
//! [`dispatch`] is where ACP conformance actually lives — which methods
//! exist, what `initialize` promises, what an unknown method answers — and
//! none of it was covered before, because the only writer wrote to real
//! stdout. [`AcpWriter::channel`] is the seam that fixes that: frames land
//! in a channel the test drains.

use super::*;
use crate::domain::event::CursorEvent;
use crate::domain::model::{CursorRunId, RunStatus};
use crate::domain::model::{McpHeader, McpServer, McpTransport};
use crate::testing::{CursorCall, FakeCursor, FixedRepos};
use agent_client_protocol::schema::v1::InitializeResponse;
use tokio::io::AsyncBufReadExt as _;
use tokio::io::AsyncWriteExt as _;

type Service = CursorSessionService<FakeCursor, AcpNotifier, FixedRepos>;

/// A service wired to a channel-backed writer, plus the frame receiver.
fn harness() -> (
    Arc<Service>,
    AcpWriter,
    mpsc::UnboundedReceiver<RawJsonRpcMessage>,
) {
    let (writer, frames) = AcpWriter::channel();
    let service = Arc::new(CursorSessionService::new(
        FakeCursor::new(),
        AcpNotifier::new(writer.clone()),
        FixedRepos(None),
    ));
    (service, writer, frames)
}

/// Build a request frame by parsing the JSON a client would actually send,
/// so the test exercises the same deserialize the read loop does.
fn request(id: i64, method: &str, params: serde_json::Value) -> RawJsonRpcMessage {
    serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    }))
    .expect("a well-formed request frame")
}

/// The next frame written, as the JSON it would go out as.
fn next_frame(frames: &mut mpsc::UnboundedReceiver<RawJsonRpcMessage>) -> serde_json::Value {
    let frame = frames.try_recv().expect("a frame was written");
    serde_json::to_value(&frame).expect("frames serialize")
}

/// The next frame's `result`, panicking if it carried an error instead.
fn expect_result(frames: &mut mpsc::UnboundedReceiver<RawJsonRpcMessage>) -> serde_json::Value {
    let frame = next_frame(frames);
    assert!(
        frame.get("error").is_none(),
        "expected a result, got error {frame}"
    );
    frame
        .get("result")
        .cloned()
        .unwrap_or_else(|| panic!("no result in {frame}"))
}

/// The next frame's JSON-RPC error code, panicking if it succeeded.
fn expect_error_code(frames: &mut mpsc::UnboundedReceiver<RawJsonRpcMessage>) -> i64 {
    let frame = next_frame(frames);
    frame
        .pointer("/error/code")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_else(|| panic!("no error code in {frame}"))
}

/// `initialize` must answer with a version the client can actually speak.
///
/// The response version was hardcoded to `V1` regardless of the request, so a
/// client offering only v0 was told v1 and the two then disagreed about the
/// wire format with nothing to detect it.
#[tokio::test]
async fn initialize_negotiates_down_to_the_clients_version() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(1, "initialize", serde_json::json!({ "protocolVersion": 0 })),
    );

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&mut frames)).expect("an initialize response");
    assert_eq!(
        response.protocol_version,
        ProtocolVersion::V0,
        "a client that offered v0 must not be answered v1"
    );
}

/// A client offering a version newer than ours gets ours, not its own.
#[tokio::test]
async fn initialize_caps_a_newer_client_at_our_version() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(
            1,
            "initialize",
            serde_json::json!({ "protocolVersion": 99 }),
        ),
    );

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&mut frames)).expect("an initialize response");
    assert_eq!(response.protocol_version, ProtocolVersion::V1);
}

/// `prompt_text` already turns a `ResourceLink` into an `@`-mention, so
/// advertising `embeddedContext: false` suppresses context the agent handles
/// perfectly well.
#[tokio::test]
async fn initialize_advertises_the_prompt_capabilities_we_actually_have() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(1, "initialize", serde_json::json!({ "protocolVersion": 1 })),
    );

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&mut frames)).expect("an initialize response");
    let capabilities = &response.agent_capabilities.prompt_capabilities;
    assert!(
        capabilities.embedded_context,
        "resource links are handled, so embedded context must be advertised"
    );
    // Cursor's prompt body is text-only; claiming these would be a lie.
    assert!(!capabilities.image);
    assert!(!capabilities.audio);
}

/// `session/close` must be dispatched, or `CursorSessionService::close` is
/// dead code and the session map grows for the whole process lifetime.
#[tokio::test]
async fn session_close_forgets_the_session() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(1, "session/new", serde_json::json!({ "cwd": "/workspace" })),
    );
    let session = expect_result(&mut frames)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    dispatch(
        &service,
        &writer,
        request(
            2,
            "session/close",
            serde_json::json!({ "sessionId": session.clone() }),
        ),
    );
    let _ = expect_result(&mut frames);

    // The service must no longer know it.
    let error = service
        .prompt(&AcpSessionId::new(session), "hi")
        .await
        .expect_err("a closed session is gone");
    assert!(matches!(
        error,
        crate::domain::error::SessionError::UnknownSession(_)
    ));
}

/// Closing a session that was never opened is an error, not a panic.
#[tokio::test]
async fn closing_an_unknown_session_is_an_error() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(
            1,
            "session/close",
            serde_json::json!({ "sessionId": "nope" }),
        ),
    );

    assert_eq!(
        expect_error_code(&mut frames),
        -32602,
        "an unknown session is invalid params"
    );
}

/// Methods this agent genuinely does not implement still answer properly.
#[tokio::test]
async fn unimplemented_methods_answer_method_not_found() {
    let (service, writer, mut frames) = harness();

    for method in ["session/set_mode", "session/fork", "logout"] {
        dispatch(&service, &writer, request(1, method, serde_json::json!({})));
        assert_eq!(
            expect_error_code(&mut frames),
            -32601,
            "{method} should be method_not_found"
        );
    }
}

/// A `session/new` carrying MCP servers still opens a session — dropping the
/// request would be worse than ignoring a field we cannot honour — but the
/// servers are not silently accepted, they are warned about.
#[tokio::test]
async fn session_new_still_succeeds_when_mcp_servers_are_named() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(
            1,
            "session/new",
            serde_json::json!({
                "cwd": "/workspace",
                "mcpServers": [{ "name": "whatever", "command": "x", "args": [] }],
            }),
        ),
    );

    assert!(
        expect_result(&mut frames)["sessionId"].is_string(),
        "an unhonourable field must not fail the request"
    );
}

/// The frame reader half of an in-process client: one JSON frame per line.
async fn next_client_frame<Reader>(lines: &mut tokio::io::Lines<Reader>) -> serde_json::Value
where
    Reader: tokio::io::AsyncBufRead + Unpin,
{
    let line = tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line())
        .await
        .expect("a frame arrives before the test times out")
        .expect("the pipe is readable")
        .expect("the agent did not hang up");
    serde_json::from_str(&line).expect("a json frame")
}

/// Write one frame as the client would: JSON, one line, no more.
async fn send_client_frame<Writer>(writer: &mut Writer, frame: serde_json::Value)
where
    Writer: tokio::io::AsyncWrite + Unpin,
{
    writer
        .write_all(format!("{frame}\n").as_bytes())
        .await
        .expect("the pipe is writable");
}

/// The adapter must be transport-agnostic: an in-process client driving it
/// over a `tokio::io::duplex` pipe has to get the same conversation a
/// subprocess gets over stdio. Nothing about `serve` may assume stdio.
///
/// The frame order is the other half of the point. The turn's
/// `session/update` notification has to precede the `session/prompt`
/// response, which only holds because the notifier and the writer share one
/// queue — two queues would let the response overtake its own updates.
#[tokio::test]
async fn serve_runs_a_whole_conversation_over_an_in_process_pipe() {
    let (client_side, agent_side) = tokio::io::duplex(16 * 1024);
    let (agent_reader, agent_writer) = tokio::io::split(agent_side);
    let (client_reader, mut client_writer) = tokio::io::split(client_side);
    let mut client_frames = tokio::io::BufReader::new(client_reader).lines();

    let cursor = FakeCursor::new();
    let events = cursor.script_stream();
    let (writer, run_writer) = AcpWriter::new(agent_writer);
    let service = Arc::new(CursorSessionService::new(
        cursor,
        AcpNotifier::new(writer.clone()),
        FixedRepos(None),
    ));
    let writer_task = tokio::spawn(run_writer);
    let serve_task = tokio::spawn(serve(service, agent_reader, writer));

    send_client_frame(
        &mut client_writer,
        serde_json::json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "initialize", "params": { "protocolVersion": 1 },
        }),
    )
    .await;
    let initialize = next_client_frame(&mut client_frames).await;
    assert_eq!(initialize["id"], 1);
    assert_eq!(initialize["result"]["protocolVersion"], 1);

    send_client_frame(
        &mut client_writer,
        serde_json::json!({
            "jsonrpc": "2.0", "id": 2,
            "method": "session/new", "params": { "cwd": "/workspace" },
        }),
    )
    .await;
    let opened = next_client_frame(&mut client_frames).await;
    assert_eq!(opened["id"], 2);
    let session = opened["result"]["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    send_client_frame(
        &mut client_writer,
        serde_json::json!({
            "jsonrpc": "2.0", "id": 3,
            "method": "session/prompt",
            "params": {
                "sessionId": session,
                "prompt": [{ "type": "text", "text": "do it" }],
            },
        }),
    )
    .await;
    events
        .send(CursorEvent::Assistant {
            text: "hello".to_owned(),
        })
        .expect("stream open");
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: Some(1),
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    drop(events);

    let update = next_client_frame(&mut client_frames).await;
    assert_eq!(update["method"], "session/update");
    assert_eq!(update["params"]["sessionId"], session.as_str());
    assert_eq!(
        update["params"]["update"]["content"]["text"], "hello",
        "the streamed assistant text must reach the client, in {update}"
    );

    let answered = next_client_frame(&mut client_frames).await;
    assert_eq!(answered["id"], 3, "the response follows its own updates");
    assert_eq!(answered["result"]["stopReason"], "end_turn");

    // Hanging up the client end is EOF for `serve`, which drops the service
    // and its writer handle, which drains and ends the writer task. Both
    // halves have to go: `tokio::io::split` only closes the pipe once the
    // last of them is dropped.
    drop(client_writer);
    drop(client_frames);
    serve_task.await.expect("serve exits on eof");
    writer_task.await.expect("the writer drains and exits");
}

/// Remote MCP servers named at `session/new` are forwarded to Cursor.
///
/// `POST /v1/agents` accepts `mcpServers[]` with `url`/`headers`, so an HTTP
/// or SSE server the client configures is genuinely reachable from the cloud
/// agent — there is nothing to decline.
#[tokio::test]
async fn remote_mcp_servers_are_forwarded_to_the_agent() {
    let (writer, mut frames) = AcpWriter::channel();
    let cursor = FakeCursor::new();
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        AcpNotifier::new(writer.clone()),
        FixedRepos(None),
    ));

    dispatch(
        &service,
        &writer,
        request(
            1,
            "session/new",
            serde_json::json!({
                "cwd": "/workspace",
                "mcpServers": [
                    {
                        "type": "http",
                        "name": "docs",
                        "url": "https://mcp.example.com",
                        "headers": [{ "name": "Authorization", "value": "Bearer t" }],
                    },
                    {
                        "type": "sse",
                        "name": "events",
                        "url": "https://mcp.example.com/sse",
                        "headers": [],
                    },
                ],
            }),
        ),
    );
    let session = expect_result(&mut frames)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let events = cursor.script_stream();
    events
        .send(crate::domain::event::CursorEvent::Result {
            run_id: crate::domain::model::CursorRunId::new("run-fake-1"),
            status: crate::domain::model::RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events
        .send(crate::domain::event::CursorEvent::Done)
        .expect("stream open");
    service
        .prompt(&AcpSessionId::new(session), "go")
        .await
        .expect("prompt runs");

    let calls = cursor.calls();
    let [CursorCall::CreateAgent(_, _, servers)] = calls.as_slice() else {
        panic!("expected one create_agent, got {calls:?}");
    };
    assert_eq!(
        servers,
        &vec![
            McpServer {
                name: "docs".to_owned(),
                transport: McpTransport::Http,
                url: "https://mcp.example.com".to_owned(),
                headers: vec![McpHeader {
                    name: "Authorization".to_owned(),
                    value: "Bearer t".to_owned(),
                }],
            },
            McpServer {
                name: "events".to_owned(),
                transport: McpTransport::Sse,
                url: "https://mcp.example.com/sse".to_owned(),
                headers: Vec::new(),
            },
        ]
    );
}

/// A stdio MCP server is declined, not forwarded.
///
/// ACP defines `command` as an absolute path on the *client's* machine, and
/// its `env` carries literal values that are routinely credentials. Sending
/// either to Cursor's sandbox would spawn something else, somewhere else,
/// with the user's secrets — and look configured while doing it. The session
/// still opens; only the unhonourable server is dropped.
#[tokio::test]
async fn stdio_mcp_servers_are_declined_without_failing_the_session() {
    let (writer, mut frames) = AcpWriter::channel();
    let cursor = FakeCursor::new();
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        AcpNotifier::new(writer.clone()),
        FixedRepos(None),
    ));

    dispatch(
        &service,
        &writer,
        request(
            1,
            "session/new",
            serde_json::json!({
                "cwd": "/workspace",
                "mcpServers": [
                    {
                        "name": "local",
                        "command": "/usr/local/bin/my-mcp",
                        "args": ["--stdio"],
                        "env": [{ "name": "TOKEN", "value": "secret" }],
                    },
                    {
                        "type": "http",
                        "name": "remote",
                        "url": "https://mcp.example.com",
                        "headers": [],
                    },
                ],
            }),
        ),
    );
    let session = expect_result(&mut frames)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let events = cursor.script_stream();
    events
        .send(crate::domain::event::CursorEvent::Result {
            run_id: crate::domain::model::CursorRunId::new("run-fake-1"),
            status: crate::domain::model::RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events
        .send(crate::domain::event::CursorEvent::Done)
        .expect("stream open");
    service
        .prompt(&AcpSessionId::new(session), "go")
        .await
        .expect("prompt runs");

    let calls = cursor.calls();
    let [CursorCall::CreateAgent(_, _, servers)] = calls.as_slice() else {
        panic!("expected one create_agent");
    };
    let names: Vec<&str> = servers.iter().map(|server| server.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["remote"],
        "the stdio server must be dropped and the remote one kept"
    );
}

/// The capabilities must now claim the remote transports, because they are
/// really forwarded — advertising false suppressed servers that work.
#[tokio::test]
async fn initialize_advertises_the_remote_mcp_transports() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(1, "initialize", serde_json::json!({ "protocolVersion": 1 })),
    );

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&mut frames)).expect("an initialize response");
    let mcp = &response.agent_capabilities.mcp_capabilities;
    assert!(mcp.http, "http MCP servers are forwarded");
    assert!(mcp.sse, "sse MCP servers are forwarded");
}

/// The whole handshake, pinned.
///
/// The tests above assert *why* individual capabilities are what they are —
/// that reasoning is the point of them, and it stays readable as the set
/// grows. This pins the entire response instead, so a capability appearing or
/// disappearing shows up as a diff no matter which one it is. Capabilities are
/// promises to the client about what it may send; one drifting unnoticed means
/// clients either suppress input the agent handles or send input it drops.
#[tokio::test]
async fn the_initialize_response_is_pinned_whole() {
    let (service, writer, mut frames) = harness();

    dispatch(
        &service,
        &writer,
        request(1, "initialize", serde_json::json!({ "protocolVersion": 1 })),
    );

    let mut response = expect_result(&mut frames);
    // The version moves with the crate; everything else is the contract.
    if let Some(info) = response
        .get_mut("agentInfo")
        .and_then(|i| i.as_object_mut())
    {
        info.insert("version".to_owned(), serde_json::json!("[crate version]"));
    }
    insta::assert_json_snapshot!(response);
}

/// `session/load` finds a restored session and refuses an unknown one. The
/// restored path is what a Macro harness restart walks: restore, load, then
/// prompt the existing agent.
#[tokio::test]
async fn session_load_answers_for_restored_sessions_only() {
    let (client_side, agent_side) = tokio::io::duplex(16 * 1024);
    let (agent_reader, agent_writer) = tokio::io::split(agent_side);
    let (client_reader, mut client_writer) = tokio::io::split(client_side);
    let mut client_frames = tokio::io::BufReader::new(client_reader).lines();

    let cursor = FakeCursor::new();
    let (writer, run_writer) = AcpWriter::new(agent_writer);
    let service = Arc::new(CursorSessionService::new(
        cursor,
        AcpNotifier::new(writer.clone()),
        FixedRepos(None),
    ));
    service.restore_session(
        AcpSessionId::new("cursor-acp-3"),
        Some(crate::domain::model::CursorAgentId::new("bc-restored")),
        None,
        Vec::new(),
    );
    let writer_task = tokio::spawn(run_writer);
    let serve_task = tokio::spawn(serve(service, agent_reader, writer));

    send_client_frame(
        &mut client_writer,
        serde_json::json!({
            "jsonrpc": "2.0", "id": 1,
            "method": "session/load",
            "params": { "sessionId": "cursor-acp-3", "cwd": "/workspace", "mcpServers": [] },
        }),
    )
    .await;
    let loaded = next_client_frame(&mut client_frames).await;
    assert_eq!(loaded["id"], 1);
    assert!(loaded.get("error").is_none(), "got {loaded}");

    send_client_frame(
        &mut client_writer,
        serde_json::json!({
            "jsonrpc": "2.0", "id": 2,
            "method": "session/load",
            "params": { "sessionId": "cursor-acp-999", "cwd": "/workspace", "mcpServers": [] },
        }),
    )
    .await;
    let unknown = next_client_frame(&mut client_frames).await;
    assert_eq!(unknown["id"], 2);
    assert!(unknown.get("error").is_some(), "got {unknown}");

    drop(client_writer);
    drop(client_frames);
    serve_task.await.expect("serve ends");
    writer_task.await.expect("writer ends");
}
