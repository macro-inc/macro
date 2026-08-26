//! Tests for the ACP adapter, driven over real transports.
//!
//! Most tests speak to the agent the way a client would: frames in, frames
//! out, over an in-memory [`Channel`] pair. That covers the whole path a
//! production frame takes — the SDK's parse, our handler, the SDK's response
//! — rather than a dispatch function called directly. One test drives the
//! byte-stream transport instead, because that is what the binary and the
//! Macro harness actually serve over, and it is where the frame-ordering
//! guarantee (a turn's updates precede its own response) is observable.

use super::*;
use crate::domain::event::CursorEvent;
use crate::domain::model::{CursorModel, CursorRunId, ModelParam, ModelVariant, RunStatus};
use crate::testing::{CursorCall, FakeCursor, FixedRepos};
use agent_client_protocol::schema::v1::InitializeResponse;
use agent_client_protocol::{Channel, RawJsonRpcMessage, TransportFrame};
use futures::StreamExt as _;
use futures::channel::mpsc;
use tokio::io::AsyncBufReadExt as _;
use tokio::io::AsyncWriteExt as _;

type Service = CursorSessionService<FakeCursor, AcpNotifier, FixedRepos>;

/// The client's end of a served connection.
struct TestClient {
    to_agent: mpsc::UnboundedSender<TransportFrame>,
    from_agent: mpsc::UnboundedReceiver<TransportFrame>,
}

impl TestClient {
    /// Send one frame, built by parsing the JSON a client would actually
    /// write, so the test exercises the same deserialize the wire does.
    fn send(&self, frame: serde_json::Value) {
        let message: RawJsonRpcMessage =
            serde_json::from_value(frame).expect("a well-formed frame");
        self.to_agent
            .unbounded_send(TransportFrame::Single(message))
            .expect("the connection is up");
    }

    /// The next frame the agent writes, as the JSON it would go out as.
    async fn next_frame(&mut self) -> serde_json::Value {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(5), self.from_agent.next())
            .await
            .expect("a frame arrives before the test times out")
            .expect("the agent did not hang up");
        match frame {
            TransportFrame::Single(message) => {
                serde_json::to_value(&message).expect("frames serialize")
            }
            other => panic!("expected a single frame, got {other:?}"),
        }
    }

    /// One request/response round trip.
    async fn call(
        &mut self,
        id: i64,
        method: &str,
        params: serde_json::Value,
    ) -> serde_json::Value {
        self.send(serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }));
        self.next_frame().await
    }
}

/// A served connection over a [`Channel`] pair, plus the pieces the tests
/// assert against.
fn harness() -> (Arc<Service>, FakeCursor, TestClient) {
    let cursor = FakeCursor::new();
    let (service, client) = serve_over_channel(cursor.clone(), |_| {});
    (service, cursor, client)
}

/// [`harness`], with a hook to shape the service before it starts serving —
/// what a real host does with [`CursorSessionService::restore_session`].
fn serve_over_channel(
    cursor: FakeCursor,
    configure: impl FnOnce(&Service),
) -> (Arc<Service>, TestClient) {
    serve_over_channel_with_default_model(cursor, None, configure)
}

/// [`serve_over_channel`], for a deployment that pins a model.
///
/// Separate because the default is fixed at construction: it is deployment
/// configuration, not something a client can set, and the service takes it by
/// value.
fn serve_over_channel_with_default_model(
    cursor: FakeCursor,
    default_model: Option<&str>,
    configure: impl FnOnce(&Service),
) -> (Arc<Service>, TestClient) {
    let notifier = AcpNotifier::new();
    let service = Arc::new(
        CursorSessionService::new(cursor, notifier.clone(), FixedRepos(None))
            .with_default_model(default_model.map(str::to_owned)),
    );
    configure(&service);
    let (agent_end, client_end) = Channel::duplex();
    tokio::spawn(serve_transport(Arc::clone(&service), notifier, agent_end));
    (
        service,
        TestClient {
            to_agent: client_end.tx,
            from_agent: client_end.rx,
        },
    )
}

/// A response frame's `result`, panicking if it carried an error instead.
fn expect_result(frame: &serde_json::Value) -> serde_json::Value {
    assert!(
        frame.get("error").is_none(),
        "expected a result, got error {frame}"
    );
    frame
        .get("result")
        .cloned()
        .unwrap_or_else(|| panic!("no result in {frame}"))
}

/// A response frame's JSON-RPC error code, panicking if it succeeded.
fn expect_error_code(frame: &serde_json::Value) -> i64 {
    frame
        .pointer("/error/code")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_else(|| panic!("no error code in {frame}"))
}

/// `initialize` must answer with a version the client can actually speak.
///
/// The response version was once hardcoded to `V1` regardless of the request,
/// so a client offering only v0 was told v1 and the two then disagreed about
/// the wire format with nothing to detect it.
#[tokio::test]
async fn initialize_negotiates_down_to_the_clients_version() {
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(1, "initialize", serde_json::json!({ "protocolVersion": 0 }))
        .await;

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&frame)).expect("an initialize response");
    assert_eq!(
        response.protocol_version,
        ProtocolVersion::V0,
        "a client that offered v0 must not be answered v1"
    );
}

/// A client offering a version newer than ours gets ours, not its own.
#[tokio::test]
async fn initialize_caps_a_newer_client_at_our_version() {
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(
            1,
            "initialize",
            serde_json::json!({ "protocolVersion": 99 }),
        )
        .await;

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&frame)).expect("an initialize response");
    assert_eq!(response.protocol_version, ProtocolVersion::V1);
}

/// `prompt_text` already turns a `ResourceLink` into an `@`-mention, so
/// advertising `embeddedContext: false` suppresses context the agent handles
/// perfectly well.
#[tokio::test]
async fn initialize_advertises_the_prompt_capabilities_we_actually_have() {
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(1, "initialize", serde_json::json!({ "protocolVersion": 1 }))
        .await;

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&frame)).expect("an initialize response");
    let capabilities = &response.agent_capabilities.prompt_capabilities;
    assert!(
        capabilities.embedded_context,
        "resource links are handled, so embedded context must be advertised"
    );
    // Cursor's prompt body is text-only; claiming these would be a lie.
    assert!(!capabilities.image);
    assert!(!capabilities.audio);
}

/// `session/close` must be served, or `CursorSessionService::close` is dead
/// code and the session map grows for the whole process lifetime.
#[tokio::test]
async fn session_close_forgets_the_session() {
    let (service, _cursor, mut client) = harness();

    let opened = client
        .call(
            1,
            "session/new",
            serde_json::json!({ "cwd": "/workspace", "mcpServers": [] }),
        )
        .await;
    let session = expect_result(&opened)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let closed = client
        .call(
            2,
            "session/close",
            serde_json::json!({ "sessionId": session.clone() }),
        )
        .await;
    let _ = expect_result(&closed);

    // The service must no longer know it.
    let error = service
        .prompt(&SessionId::new(session), "hi")
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
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(
            1,
            "session/close",
            serde_json::json!({ "sessionId": "nope" }),
        )
        .await;

    assert_eq!(
        expect_error_code(&frame),
        -32602,
        "an unknown session is invalid params"
    );
}

/// A `session/new` that omits `mcpServers` is refused, not guessed at.
///
/// ACP marks the member required, so a conformant client always sends it —
/// as `[]` when it configures nothing. This agent used to inject the empty
/// list itself; now that the schema parses the request before the handler
/// runs, the schema's strictness is the behaviour, and it matches what the
/// field's absence actually means: a client this agent does not understand.
#[tokio::test]
async fn session_new_requires_the_mcp_servers_member() {
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(1, "session/new", serde_json::json!({ "cwd": "/workspace" }))
        .await;

    assert_eq!(expect_error_code(&frame), -32602);
}

/// Methods this agent genuinely does not implement still answer properly.
#[tokio::test]
async fn unimplemented_methods_answer_method_not_found() {
    let (_service, _cursor, mut client) = harness();

    for (id, method) in [(1, "session/set_mode"), (2, "session/fork"), (3, "logout")] {
        let frame = client.call(id, method, serde_json::json!({})).await;
        assert_eq!(
            expect_error_code(&frame),
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
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(
            1,
            "session/new",
            serde_json::json!({
                "cwd": "/workspace",
                "mcpServers": [{ "name": "whatever", "command": "x", "args": [] }],
            }),
        )
        .await;

    assert!(
        expect_result(&frame)["sessionId"].is_string(),
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

/// The byte-stream transport carries a whole conversation, and in order.
///
/// This is the transport the binary and the Macro harness actually serve
/// over: newline-delimited JSON on a byte pipe. The frame order is the other
/// half of the point — the turn's `session/update` notification has to
/// precede the `session/prompt` response, which holds because notifications
/// and responses share the connection's one outgoing queue.
#[tokio::test]
async fn serve_runs_a_whole_conversation_over_an_in_process_pipe() {
    let (client_side, agent_side) = tokio::io::duplex(16 * 1024);
    let (agent_reader, agent_writer) = tokio::io::split(agent_side);
    let (client_reader, mut client_writer) = tokio::io::split(client_side);
    let mut client_frames = tokio::io::BufReader::new(client_reader).lines();

    let cursor = FakeCursor::new();
    let events = cursor.script_stream();
    let notifier = AcpNotifier::new();
    let service = Arc::new(CursorSessionService::new(
        cursor,
        notifier.clone(),
        FixedRepos(None),
    ));
    let serve_task = tokio::spawn(serve(service, notifier, agent_reader, agent_writer));

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
            "method": "session/new",
            "params": { "cwd": "/workspace", "mcpServers": [] },
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

    // Hanging up the client end is EOF for the connection, which drains any
    // queued frames and resolves. Both halves have to go: `tokio::io::split`
    // only closes the pipe once the last of them is dropped.
    drop(client_writer);
    drop(client_frames);
    serve_task
        .await
        .expect("the serve task joins")
        .expect("clean eof resolves ok");
}

/// Remote MCP servers named at `session/new` are forwarded to Cursor.
///
/// `POST /v1/agents` accepts `mcpServers[]` with `url`/`headers`, so an HTTP
/// or SSE server the client configures is genuinely reachable from the cloud
/// agent — there is nothing to decline.
#[tokio::test]
async fn remote_mcp_servers_are_forwarded_to_the_agent() {
    let (service, cursor, mut client) = harness();

    let opened = client
        .call(
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
        )
        .await;
    let session = expect_result(&opened)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service
        .prompt(&SessionId::new(session), "go")
        .await
        .expect("prompt runs");

    let calls = cursor.calls();
    let [CursorCall::CreateAgent(_, _, servers, _)] = calls.as_slice() else {
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
    let (service, cursor, mut client) = harness();

    let opened = client
        .call(
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
        )
        .await;
    let session = expect_result(&opened)["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service
        .prompt(&SessionId::new(session), "go")
        .await
        .expect("prompt runs");

    let calls = cursor.calls();
    let [CursorCall::CreateAgent(_, _, servers, _)] = calls.as_slice() else {
        panic!("expected one create_agent");
    };
    let names: Vec<&str> = servers.iter().map(|server| server.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["remote"],
        "the stdio server must be dropped and the remote one kept"
    );
}

/// The capabilities must claim the remote transports, because they are really
/// forwarded — advertising false suppressed servers that work.
#[tokio::test]
async fn initialize_advertises_the_remote_mcp_transports() {
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(1, "initialize", serde_json::json!({ "protocolVersion": 1 }))
        .await;

    let response: InitializeResponse =
        serde_json::from_value(expect_result(&frame)).expect("an initialize response");
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
    let (_service, _cursor, mut client) = harness();

    let frame = client
        .call(1, "initialize", serde_json::json!({ "protocolVersion": 1 }))
        .await;

    let mut response = expect_result(&frame);
    // The version moves with the crate; everything else is the contract.
    if let Some(info) = response
        .get_mut("agentInfo")
        .and_then(|info| info.as_object_mut())
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
    let (_service, mut client) = serve_over_channel(FakeCursor::new(), |service| {
        service.restore_session(
            SessionId::new("cursor-acp-3"),
            Some(crate::domain::model::CursorAgentId::new("bc-restored")),
            None,
            None,
        );
    });

    let loaded = client
        .call(
            1,
            "session/load",
            serde_json::json!({
                "sessionId": "cursor-acp-3", "cwd": "/workspace", "mcpServers": [],
            }),
        )
        .await;
    assert!(loaded.get("error").is_none(), "got {loaded}");

    let unknown = client
        .call(
            2,
            "session/load",
            serde_json::json!({
                "sessionId": "cursor-acp-999", "cwd": "/workspace", "mcpServers": [],
            }),
        )
        .await;
    assert!(unknown.get("error").is_some(), "got {unknown}");
}

/// Two models, the second with a non-trivial default variant, as
/// `GET /v1/models` would report them.
fn offered_models() -> Vec<CursorModel> {
    vec![
        CursorModel {
            id: "composer-2.5".to_owned(),
            display_name: "Composer 2.5".to_owned(),
            variants: vec![ModelVariant {
                params: Vec::new(),
                is_default: true,
            }],
        },
        CursorModel {
            id: "gpt-5.5".to_owned(),
            display_name: "GPT-5.5".to_owned(),
            variants: vec![
                ModelVariant {
                    params: vec![ModelParam {
                        id: "reasoning".to_owned(),
                        value: "low".to_owned(),
                    }],
                    is_default: false,
                },
                ModelVariant {
                    params: vec![ModelParam {
                        id: "reasoning".to_owned(),
                        value: "medium".to_owned(),
                    }],
                    is_default: true,
                },
            ],
        },
    ]
}

/// `session/new` advertises the account's models as an ACP select, which is the
/// whole of how a client learns what it may pick.
#[tokio::test]
async fn session_new_advertises_the_models_as_a_config_option() {
    let cursor = FakeCursor::new();
    cursor.script_models(offered_models());
    let (_service, mut client) =
        serve_over_channel_with_default_model(cursor, Some("composer-2.5"), |_| {});

    let response = client
        .call(
            1,
            "session/new",
            serde_json::json!({"cwd": "/workspace", "mcpServers": []}),
        )
        .await;
    let result = expect_result(&response);
    let options = result["configOptions"]
        .as_array()
        .expect("config options are advertised");
    let [option] = options.as_slice() else {
        panic!("expected exactly the model option, got {options:?}");
    };
    assert_eq!(option["id"], "model");
    assert_eq!(option["currentValue"], "composer-2.5");
    let values: Vec<&str> = option["options"]
        .as_array()
        .expect("selectable options")
        .iter()
        .map(|entry| entry["value"].as_str().expect("a value id"))
        .collect();
    assert_eq!(values, vec!["composer-2.5", "gpt-5.5"]);
}

/// Setting the model mid-session is accepted and reflected back, and the next
/// run carries it — the point being that Cursor honours `model` on a follow-up
/// run, so a change does not have to wait for a new agent.
#[tokio::test]
async fn setting_the_model_changes_what_the_next_run_asks_for() {
    let cursor = FakeCursor::new();
    cursor.script_models(offered_models());
    let (_service, mut client) =
        serve_over_channel_with_default_model(cursor.clone(), Some("composer-2.5"), |_| {});

    let session = expect_result(
        &client
            .call(
                1,
                "session/new",
                serde_json::json!({"cwd": "/workspace", "mcpServers": []}),
            )
            .await,
    )["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let response = client
        .call(
            2,
            "session/set_config_option",
            serde_json::json!({
                "sessionId": session,
                "configId": "model",
                "value": "gpt-5.5",
            }),
        )
        .await;
    let result = expect_result(&response);
    // Answered with the whole option set, so a client folds config from one
    // shape whichever response carried it.
    assert_eq!(result["configOptions"][0]["currentValue"], "gpt-5.5");

    // And the run actually asks for it. This is the behaviour the whole feature
    // rests on: Cursor honours `model` on a follow-up run, so the choice does
    // not have to wait for a new agent — and it must carry the variant's params,
    // because Cursor rejects an id whose params are not a variant it knows.
    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: Some(1),
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    client
        .call(
            3,
            "session/prompt",
            serde_json::json!({
                "sessionId": session,
                "prompt": [{"type": "text", "text": "go"}],
            }),
        )
        .await;

    let asked = cursor
        .calls()
        .into_iter()
        .find_map(|call| match call {
            CursorCall::CreateAgent(_, _, _, model) => Some(model),
            _ => None,
        })
        .expect("the turn created an agent");
    let asked = asked.expect("the turn named a model");
    assert_eq!(asked.id, "gpt-5.5");
    assert_eq!(
        asked.params,
        vec![ModelParam {
            id: "reasoning".to_owned(),
            value: "medium".to_owned(),
        }],
        "the default variant's params travel with the id"
    );
}

/// An id this account was never offered is refused here, with the list, rather
/// than accepted and left to fail at the next prompt as a Cursor
/// `validation_error`.
#[tokio::test]
async fn setting_an_unoffered_model_is_refused() {
    let cursor = FakeCursor::new();
    cursor.script_models(offered_models());
    let (_service, mut client) =
        serve_over_channel_with_default_model(cursor, Some("composer-2.5"), |_| {});

    let session = expect_result(
        &client
            .call(
                1,
                "session/new",
                serde_json::json!({"cwd": "/workspace", "mcpServers": []}),
            )
            .await,
    )["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    let response = client
        .call(
            2,
            "session/set_config_option",
            serde_json::json!({
                "sessionId": session,
                "configId": "model",
                "value": "gpt-9-imaginary",
            }),
        )
        .await;
    assert!(
        response.get("error").is_some(),
        "expected an error, got {response}"
    );
}

/// A restored session's next run asks for the model it was using before the
/// restart, params re-resolved from the live model table.
///
/// The regression this pins: the wrapper's model selection was in-memory only,
/// so after a resume the UI kept showing the picked model while the runs went
/// to whatever Cursor resolved — a silent divergence.
#[tokio::test]
async fn a_restored_session_keeps_its_model() {
    let cursor = FakeCursor::new();
    cursor.script_models(offered_models());
    let (service, mut client) = serve_over_channel(cursor.clone(), |service| {
        service.restore_session(
            SessionId::new("cursor-acp-3"),
            Some(crate::domain::model::CursorAgentId::new("bc-restored")),
            None,
            Some("gpt-5.5".to_owned()),
        );
    });

    // The picker is repopulated at load, current value included — this is the
    // other half of the regression, where the options came back empty.
    let loaded = client
        .call(
            1,
            "session/load",
            serde_json::json!({"sessionId": "cursor-acp-3", "cwd": "/workspace", "mcpServers": []}),
        )
        .await;
    let result = expect_result(&loaded);
    assert_eq!(result["configOptions"][0]["currentValue"], "gpt-5.5");

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service
        .prompt(&SessionId::new("cursor-acp-3"), "go")
        .await
        .expect("prompt runs");

    let asked = cursor
        .calls()
        .into_iter()
        .find_map(|call| match call {
            CursorCall::CreateRun(_, _, model) => Some(model),
            _ => None,
        })
        .expect("the restored agent got a follow-up run");
    let asked = asked.expect("the run named the restored model");
    assert_eq!(asked.id, "gpt-5.5");
    assert_eq!(
        asked.params,
        vec![ModelParam {
            id: "reasoning".to_owned(),
            value: "medium".to_owned(),
        }],
        "params come from the live table's default variant, not from persistence"
    );
}

/// A restored id that is not a Cursor model resolves to "no opinion", not an
/// error. This is the common case, not a corner: the harness seeds its
/// session records with a deployment slug like `claude`, and every session
/// where nobody ever picked presents that slug at resume.
#[tokio::test]
async fn a_restored_deployment_slug_falls_back_to_cursors_default() {
    let cursor = FakeCursor::new();
    cursor.script_models(offered_models());
    let (service, _client) = serve_over_channel(cursor.clone(), |service| {
        service.restore_session(
            SessionId::new("cursor-acp-3"),
            Some(crate::domain::model::CursorAgentId::new("bc-restored")),
            None,
            Some("claude".to_owned()),
        );
    });

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service
        .prompt(&SessionId::new("cursor-acp-3"), "go")
        .await
        .expect("a prompt with an unresolvable restored model still runs");

    let asked = cursor
        .calls()
        .into_iter()
        .find_map(|call| match call {
            CursorCall::CreateRun(_, _, model) => Some(model),
            _ => None,
        })
        .expect("the restored agent got a follow-up run");
    assert_eq!(asked, None, "no opinion: Cursor resolves its own default");
}

/// `session/load` restates the client's MCP servers, and a restored session
/// whose agent was never minted applies them when the first prompt creates it.
///
/// The host cannot pass these at restore because it never had them — the list
/// is the client's, and the protocol carries it on load. Before this the
/// restore path pinned the list to empty.
#[tokio::test]
async fn session_load_restores_the_clients_mcp_servers() {
    let cursor = FakeCursor::new();
    let (service, mut client) = serve_over_channel(cursor.clone(), |service| {
        // Restored with *no* agent: the session opened, never prompted, died.
        service.restore_session(SessionId::new("cursor-acp-3"), None, None, None);
    });

    let loaded = client
        .call(
            1,
            "session/load",
            serde_json::json!({
                "sessionId": "cursor-acp-3",
                "cwd": "/workspace",
                "mcpServers": [
                    {
                        "type": "http",
                        "name": "remote",
                        "url": "https://mcp.example.com",
                        "headers": [],
                    },
                ],
            }),
        )
        .await;
    expect_result(&loaded);

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service
        .prompt(&SessionId::new("cursor-acp-3"), "go")
        .await
        .expect("prompt runs");

    let calls = cursor.calls();
    let [CursorCall::CreateAgent(_, _, servers, _)] = calls.as_slice() else {
        panic!("expected one agent creation, got {calls:?}");
    };
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "remote");
}

/// A fresh session with nothing pinned still gets the full picker, resting on
/// Cursor's own "Auto" — the gap that used to make the selector unreachable:
/// no current meant no options, and the picker was the only way to set one.
#[tokio::test]
async fn a_session_with_no_choice_rests_the_picker_on_auto() {
    let cursor = FakeCursor::new();
    let mut models = offered_models();
    models.insert(
        0,
        CursorModel {
            id: "default".to_owned(),
            display_name: "Auto".to_owned(),
            variants: vec![ModelVariant {
                params: Vec::new(),
                is_default: true,
            }],
        },
    );
    cursor.script_models(models);
    let (service, mut client) = serve_over_channel(cursor.clone(), |_| {});

    let opened = client
        .call(
            1,
            "session/new",
            serde_json::json!({"cwd": "/workspace", "mcpServers": []}),
        )
        .await;
    let result = expect_result(&opened);
    let option = &result["configOptions"][0];
    assert_eq!(option["currentValue"], "default");
    assert_eq!(
        option["options"].as_array().expect("options").len(),
        3,
        "every offered model is listed, Auto included"
    );
    let session = result["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned();

    // Auto as the resting value is display, not state: the run still omits
    // `model`, so Cursor resolves the user's own account default rather than
    // being forced onto Auto routing.
    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service
        .prompt(&SessionId::new(session), "go")
        .await
        .expect("prompt runs");
    let asked = cursor
        .calls()
        .into_iter()
        .find_map(|call| match call {
            CursorCall::CreateAgent(_, _, _, model) => Some(model),
            _ => None,
        })
        .expect("the prompt created an agent");
    assert_eq!(asked, None, "resting on Auto sends no model field");
}

/// Cursor's list without an "Auto" entry leaves no honest resting value, so
/// the picker is withheld rather than rested on a guess.
#[tokio::test]
async fn no_auto_entry_means_no_picker_rather_than_a_guess() {
    let cursor = FakeCursor::new();
    cursor.script_models(offered_models()); // no "default" entry
    let (_service, mut client) = serve_over_channel(cursor, |_| {});

    let opened = client
        .call(
            1,
            "session/new",
            serde_json::json!({"cwd": "/workspace", "mcpServers": []}),
        )
        .await;
    let result = expect_result(&opened);
    assert!(
        result["configOptions"]
            .as_array()
            .is_none_or(|options| options.is_empty()),
        "no resting value, no picker: {result}"
    );
}
