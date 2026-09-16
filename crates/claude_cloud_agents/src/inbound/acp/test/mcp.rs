use super::*;

#[derive(Clone, Default)]
struct McpCloud {
    submitted: Arc<Mutex<Vec<Value>>>,
    events: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<Result<Event>>>>>,
    prompt: Arc<Mutex<Value>>,
    fail_mcp: bool,
    omit_mcp_ack: bool,
    require_permission: bool,
}

impl McpCloud {
    fn emit(&self, payload: Value) {
        self.events
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .send(Ok(Event {
                kind: "client_event".into(),
                sequence: None,
                data: json!({"payload":payload}),
            }))
            .unwrap();
    }
    fn finish(&self) {
        self.emit(
            json!({"type":"result", "uuid":"result", "subtype":"success", "is_error":false,
            "user_message_uuid":self.prompt.lock().unwrap()["uuid"], "usage":{}}),
        );
    }
}
impl Cloud for McpCloud {
    async fn recent_sessions(&self) -> Result<Vec<SessionId>> {
        Ok(vec![])
    }
    async fn history(&self, _: &SessionId) -> Result<Vec<Event>> {
        Ok(vec![])
    }
    async fn stream(&self, _: &SessionId, _: Option<u64>) -> Result<Events> {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        *self.events.lock().unwrap() = Some(tx);
        Ok(futures::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|event| (event, rx))
        })
        .boxed())
    }
    async fn send_batch(&self, id: &SessionId, payloads: Vec<Value>) -> Result<()> {
        for payload in payloads {
            self.send(id, payload).await?;
        }
        Ok(())
    }
    async fn send(&self, _: &SessionId, payload: Value) -> Result<()> {
        self.submitted.lock().unwrap().push(payload.clone());
        if payload["request"]["subtype"] == "mcp_set_servers" && !self.omit_mcp_ack {
            self.emit(json!({"type":"control_response", "response":{
                "subtype":"success", "request_id":payload["request_id"],
                "response":{"added":["macro"], "removed":[], "errors":if self.fail_mcp {json!({"macro":"unreachable"})} else {json!({})}}
            }}));
        }
        if payload["type"] == "user" {
            *self.prompt.lock().unwrap() = payload;
            if self.require_permission {
                self.emit(json!({"type":"control_request", "request_id":"tool-permission", "request":{
                    "subtype":"can_use_tool", "tool_use_id":"tool-1", "tool_name":"mcp__macro__search", "input":{"query":"hello"}
                }}));
            } else {
                self.finish();
            }
        } else if payload["type"] == "control_response" {
            self.finish();
        }
        Ok(())
    }
}

fn remote_servers() -> Value {
    json!([{"type":"http", "name":"macro", "url":"https://egress.example/mcp-macro",
        "headers":[{"name":"Authorization", "value":"Bearer session-test"}]}])
}

async fn open(cloud: McpCloud, method: &str, servers: Value) -> ServerChannel {
    let mut channel = attach(Session::new(cloud, SessionId::parse("cse_test").unwrap()));
    channel
        .tx
        .send(frame(json!({"jsonrpc":"2.0", "id":1, "method":method,
        "params":{"sessionId":"cse_test", "cwd":"/", "mcpServers":servers}})))
        .unwrap();
    assert!(read(&mut channel).await.get("result").is_some());
    channel
}
fn prompt(channel: &ServerChannel) {
    channel
        .tx
        .send(frame(
            json!({"jsonrpc":"2.0", "id":2, "method":"session/prompt",
        "params":{"sessionId":"cse_test", "prompt":[{"type":"text", "text":"hello"}]}}),
        ))
        .unwrap();
}

#[tokio::test]
async fn new_and_resumed_sessions_forward_authenticated_mcp_before_prompt() {
    for method in ["session/new", "session/load"] {
        let cloud = McpCloud::default();
        let mut channel = open(cloud.clone(), method, remote_servers()).await;
        assert!(
            cloud.submitted.lock().unwrap().is_empty(),
            "opening must not wake the worker"
        );
        prompt(&channel);
        let result = read(&mut channel).await;
        assert_eq!(result["result"]["stopReason"], "end_turn");
        let sent = cloud.submitted.lock().unwrap();
        assert_eq!(sent[1]["request"]["subtype"], "mcp_set_servers");
        let server = &sent[1]["request"]["servers"]["macro"];
        assert_eq!(server["type"], "http");
        assert_eq!(server["url"], "https://egress.example/mcp-macro");
        assert_eq!(server["headers"]["Authorization"], "Bearer session-test");
        assert_eq!(sent.last().unwrap()["type"], "user");
    }
}

#[tokio::test]
async fn failed_mcp_setup_fails_the_turn_and_requests_interruption() {
    let cloud = McpCloud {
        fail_mcp: true,
        ..Default::default()
    };
    let mut channel = open(cloud.clone(), "session/new", remote_servers()).await;
    prompt(&channel);
    assert!(read(&mut channel).await.get("error").is_some());
    assert!(
        cloud
            .submitted
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["request"]["subtype"] == "interrupt")
    );
}

#[tokio::test]
async fn tool_permissions_roundtrip_through_the_acp_host() {
    for choice in ["allow_once", "reject_once"] {
        let cloud = McpCloud {
            require_permission: true,
            ..Default::default()
        };
        let mut channel = open(cloud.clone(), "session/new", remote_servers()).await;
        prompt(&channel);
        let request = read(&mut channel).await;
        assert_eq!(request["method"], "session/request_permission");
        assert_eq!(request["params"]["toolCall"]["toolCallId"], "tool-1");
        channel
            .tx
            .send(frame(json!({"jsonrpc":"2.0", "id":request["id"],
            "result":{"outcome":{"outcome":"selected", "optionId":choice}}})))
            .unwrap();
        assert_eq!(read(&mut channel).await["result"]["stopReason"], "end_turn");
        let sent = cloud.submitted.lock().unwrap();
        let response = sent
            .iter()
            .find(|event| event["type"] == "control_response")
            .unwrap();
        assert_eq!(response["response"]["request_id"], "tool-permission");
        assert_eq!(
            response["response"]["response"]["behavior"],
            if choice == "allow_once" {
                "allow"
            } else {
                "deny"
            }
        );
    }
}

#[tokio::test]
async fn unsupported_stdio_and_duplicate_names_fail_the_handshake() {
    for servers in [
        json!([{"name":"local", "command":"sh", "args":[], "env":[]}]),
        json!([remote_servers()[0], remote_servers()[0]]),
    ] {
        let cloud = McpCloud::default();
        let mut channel = attach(Session::new(
            cloud.clone(),
            SessionId::parse("cse_test").unwrap(),
        ));
        channel
            .tx
            .send(frame(
                json!({"jsonrpc":"2.0", "id":1, "method":"session/new",
            "params":{"cwd":"/", "mcpServers":servers}}),
            ))
            .unwrap();
        assert!(read(&mut channel).await.get("error").is_some());
        assert!(cloud.submitted.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn a_missing_mcp_acknowledgment_cannot_report_a_successful_turn() {
    let cloud = McpCloud {
        omit_mcp_ack: true,
        ..Default::default()
    };
    let mut channel = open(cloud.clone(), "session/new", remote_servers()).await;
    prompt(&channel);
    assert!(read(&mut channel).await.get("error").is_some());
    assert!(
        cloud
            .submitted
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["request"]["subtype"] == "interrupt")
    );
}

#[test]
fn sse_servers_preserve_their_transport_and_auth_headers() {
    let mut servers = remote_servers();
    servers[0]["type"] = json!("sse");
    let mapped = super::super::mcp::servers(&json!({"mcpServers":servers})).unwrap();
    let wire = serde_json::to_value(mapped).unwrap();
    assert_eq!(wire["macro"]["type"], "sse");
    assert_eq!(
        wire["macro"]["headers"]["Authorization"],
        "Bearer session-test"
    );
}
