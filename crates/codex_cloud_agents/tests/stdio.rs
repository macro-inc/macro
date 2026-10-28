//! Byte-stream protocol regressions: exercise the same framing used by Zed.
use codex_cloud_agents::domain::acp_session::{SessionService, SessionStore, StoredSession};
use codex_cloud_agents::domain::cloud::*;
use codex_cloud_agents::domain::journal::{JournalEntry, JournalInput};
use codex_cloud_agents::domain::*;
use codex_cloud_agents::inbound::acp::serve;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, DuplexStream};

type Result<T> = std::result::Result<T, rootcause::Report>;
#[derive(Clone, Default)]
struct Journal(
    Arc<Mutex<HashMap<String, StoredSession>>>,
    Arc<Mutex<HashMap<String, Vec<JournalEntry>>>>,
);
impl SessionStore for Journal {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<()> {
        self.0.lock().unwrap().insert(id.into(), state.clone());
        Ok(())
    }
    async fn read(&self, id: &str) -> std::result::Result<Vec<JournalEntry>, rootcause::Report> {
        Ok(self.1.lock().unwrap().get(id).cloned().unwrap_or_default())
    }
    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> std::result::Result<JournalEntry, rootcause::Report> {
        let mut journals = self.1.lock().unwrap();
        let entries = journals.entry(id.to_owned()).or_default();
        if entries.len() as i64 != expected {
            return Err(rootcause::report!("stale sequence"));
        }
        let entry = JournalEntry {
            sequence: expected + 1,
            turn: turn.cloned(),
            input: input.clone(),
        };
        entries.push(entry.clone());
        Ok(entry)
    }
    async fn validate(&self) -> Result<()> {
        Ok(())
    }
}
struct Auth;
impl CredentialStore for Auth {
    fn load(&self) -> Result<Option<Credentials>> {
        Ok(Some(Credentials {
            version: 1,
            access_token: Secret::new("test-access".into())?,
            refresh_token: Secret::new("test-refresh".into())?,
            expires_at: u64::MAX,
            account_id: "test-account".into(),
        }))
    }
    fn save(&self, _: &Credentials) -> Result<()> {
        Ok(())
    }
    fn clear(&self) -> Result<()> {
        Ok(())
    }
}
#[derive(Default)]
struct Calls {
    creates: AtomicUsize,
    follows: AtomicUsize,
    cancels: AtomicUsize,
    turn: AtomicUsize,
    done: AtomicBool,
    hold: AtomicBool,
    input_request: AtomicBool,
    recorded: AtomicBool,
    cancelled: AtomicBool,
}
#[derive(Clone, Default)]
struct Provider(Arc<Calls>);
impl Provider {
    fn receipt(&self, prompt: &str) -> Result<CreatedTask> {
        let turn = self.0.turn.fetch_add(1, Ordering::SeqCst) + 1;
        self.0.done.store(false, Ordering::SeqCst);
        self.0
            .recorded
            .store(prompt.contains("recorded"), Ordering::SeqCst);
        self.0
            .input_request
            .store(prompt.contains("elicitation"), Ordering::SeqCst);
        self.0.cancelled.store(false, Ordering::SeqCst);
        self.0.hold.store(prompt.contains("hold"), Ordering::SeqCst);
        Ok(CreatedTask {
            task_id: CloudId::new("task-test".into())?,
            assistant_turn_id: Some(TurnId::new(format!("turn-{turn}"))?),
            url: "https://chatgpt.com/codex/tasks/task-test".into(),
        })
    }
    fn snapshot(&self) -> Result<TaskSnapshot> {
        let status = if self.0.cancelled.load(Ordering::SeqCst) {
            "cancelled"
        } else if self.0.done.load(Ordering::SeqCst) {
            "completed"
        } else {
            "in_progress"
        };
        Ok(TaskSnapshot {
            pull_requests: vec![],
            native: None,
            task_id: CloudId::new("task-test".into())?,
            title: Some("Test".into()),
            assistant_status: Some(status.into()),
            turns: vec![TurnSnapshot {
                source: "current_assistant_turn".into(),
                id: Some(format!("turn-{}", self.0.turn.load(Ordering::SeqCst))),
                messages: vec![],
                output_types: vec![],
                has_diff: false,
            }],
        })
    }
}
impl OAuth for Provider {
    async fn begin(&self) -> Result<DeviceLogin> {
        Err(rootcause::report!("login not expected"))
    }
    async fn poll(&self, _: &DeviceLogin) -> Result<LoginPoll> {
        Err(rootcause::report!("poll not expected"))
    }
    async fn refresh(&self, _: &Credentials) -> Result<Credentials> {
        Err(rootcause::report!("refresh not expected"))
    }
    async fn environments(&self, _: &Credentials) -> Result<Vec<Environment>> {
        Ok(vec![Environment {
            id: "env-test".into(),
            label: None,
            repositories: vec![],
        }])
    }
}
impl CloudTasks for Provider {
    async fn create(&self, _: &Credentials, request: &Launch) -> Result<CreatedTask> {
        self.0.creates.fetch_add(1, Ordering::SeqCst);
        self.receipt(&request.prompt)
    }
    async fn snapshot(&self, _: &Credentials, _: &CloudId) -> Result<TaskSnapshot> {
        self.snapshot()
    }
}
impl CloudConversation for Provider {
    async fn follow_up(
        &self,
        _: &Credentials,
        _: &CloudId,
        _: &TurnId,
        prompt: &str,
    ) -> Result<CreatedTask> {
        self.0.follows.fetch_add(1, Ordering::SeqCst);
        self.receipt(prompt)
    }
    async fn cancel(&self, _: &Credentials, _: &CloudId) -> Result<()> {
        self.0.cancels.fetch_add(1, Ordering::SeqCst);
        self.0.cancelled.store(true, Ordering::SeqCst);
        Ok(())
    }
    async fn turn(&self, _: &Credentials, _: &CloudId, _: &TurnId) -> Result<TaskSnapshot> {
        self.snapshot()
    }
    async fn stream(
        &self,
        _: &Credentials,
        _: &CloudId,
        turn: &TurnId,
    ) -> Result<CloudEventStream> {
        use futures::StreamExt as _;
        let id = turn.as_str();
        if self.0.recorded.load(Ordering::SeqCst) {
            let events: Vec<CloudEvent> =
                serde_json::from_str(include_str!("fixtures/recorded_cloud_turn.json")).unwrap();
            let calls = self.0.clone();
            return Ok(Box::pin(
                futures::stream::iter(
                    events
                        .into_iter()
                        .map(|event| Ok(NativeRecord::from_event(event.clone()))),
                )
                .chain(futures::stream::once(async move {
                    calls.done.store(true, Ordering::SeqCst);
                    Ok(NativeRecord::from_event(CloudEvent {
                        id: "fixture-end".into(),
                        method: "turn/completed".into(),
                        params: json!({}),
                    }))
                })),
            ));
        }
        if self.0.input_request.load(Ordering::SeqCst) {
            return Ok(Box::pin(futures::stream::iter(vec![Ok(
                NativeRecord::from_event(CloudEvent {
                    id: format!("{id}-input"),
                    method: "item/tool/requestUserInput".into(),
                    params: json!({"requestId":"question-1","questions":[{"id":"choice","question":"Choose a branch"}]}),
                }),
            )])));
        }
        let event = CloudEvent {
            id: format!("{id}-delta"),
            method: "item/agentMessage/delta".into(),
            params: json!({"threadId":"task-test","turnId":id,"itemId":format!("{id}-message"),"delta":"Hello 🌍"}),
        };
        let complete = CloudEvent {
            id: format!("{id}-complete"),
            method: "item/completed".into(),
            params: json!({"threadId":"task-test","turnId":id,"item":{"id":format!("{id}-message"),"type":"agentMessage","text":"Hello 🌍"}}),
        };
        if self.0.hold.load(Ordering::SeqCst) {
            let activity = CloudEvent {
                id: format!("{id}-tool"),
                method: "item/started".into(),
                params: json!({"item":{"id":"running-tool","type":"commandExecution","command":"sleep 60"}}),
            };
            return Ok(Box::pin(
                futures::stream::iter(vec![Ok(NativeRecord::from_event(activity))])
                    .chain(futures::stream::pending()),
            ));
        }
        let calls = self.0.clone();
        Ok(Box::pin(
            futures::stream::iter(vec![
                Ok(NativeRecord::from_event(event.clone())),
                Ok(NativeRecord::from_event(event.clone())),
                Ok(NativeRecord::from_event(complete)),
            ])
            .chain(futures::stream::once(async move {
                calls.done.store(true, Ordering::SeqCst);
                Ok(NativeRecord::from_event(CloudEvent {
                    id: format!("done-{}", calls.turn.load(Ordering::SeqCst)),
                    method: "turn/completed".into(),
                    params: json!({}),
                }))
            })),
        ))
    }
}
struct Client {
    read: BufReader<tokio::io::ReadHalf<DuplexStream>>,
    write: tokio::io::WriteHalf<DuplexStream>,
    server: tokio::task::JoinHandle<()>,
}
impl Client {
    async fn send(&mut self, frame: Value) {
        self.write
            .write_all(format!("{frame}\n").as_bytes())
            .await
            .unwrap();
        self.write.flush().await.unwrap();
    }
    async fn next(&mut self) -> Value {
        let mut line = String::new();
        let count = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            self.read.read_line(&mut line),
        )
        .await
        .expect("ACP response timed out")
        .unwrap();
        assert_ne!(count, 0, "ACP unexpectedly closed");
        serde_json::from_str(&line).expect("stdout contains only JSON protocol frames")
    }
    async fn call(&mut self, id: i64, method: &str, params: Value) -> Vec<Value> {
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .await;
        let mut frames = vec![];
        loop {
            let frame = self.next().await;
            let done = frame["id"] == id;
            frames.push(frame);
            if done {
                return frames;
            }
        }
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.server.abort();
    }
}
fn harness(provider: Provider, journal: Journal) -> Client {
    let service = Arc::new(SessionService::new(
        Arc::new(Probe::new(provider, Auth)),
        journal,
        Some(codex_cloud_agents::domain::runtime::CloudTarget {
            environment: CloudId::new("env-test".into()).unwrap(),
            branch: "main".into(),
            repository_url: None,
        }),
    ));
    let (client, agent) = tokio::io::duplex(128 * 1024);
    let (read, write) = tokio::io::split(client);
    let (agent_read, agent_write) = tokio::io::split(agent);
    let server = tokio::spawn(async move {
        let _ = serve(service, agent_read, agent_write, None).await;
    });
    Client {
        read: BufReader::new(read),
        write,
        server,
    }
}
async fn initialize(client: &mut Client) -> Value {
    client.call(1,"initialize",json!({"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"stdio-test","version":"1"}})).await.pop().unwrap()
}
fn normalize(value: &Value, session: &str) -> Value {
    match value {
        Value::String(text) => Value::String(text.replace(session, "SESSION")),
        Value::Array(items) => Value::Array(items.iter().map(|v| normalize(v, session)).collect()),
        Value::Object(items) => Value::Object(
            items
                .iter()
                .map(|(k, v)| (k.clone(), normalize(v, session)))
                .collect(),
        ),
        _ => value.clone(),
    }
}
#[tokio::test]
async fn stdio_messages_followups_and_stop_snapshot() {
    let provider = Provider::default();
    let mut client = harness(provider.clone(), Journal::default());
    let init = initialize(&mut client).await;
    let new = client
        .call(
            2,
            "session/new",
            json!({"cwd":"/unrelated/local/repo","mcpServers":[]}),
        )
        .await;
    let session = new.last().unwrap()["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let first = client
        .call(
            3,
            "session/prompt",
            json!({"sessionId":session,"prompt":[{"type":"text","text":"hello"}]}),
        )
        .await;
    let second = client
        .call(
            4,
            "session/prompt",
            json!({"sessionId":session,"prompt":[{"type":"text","text":"again"}]}),
        )
        .await;
    client.send(json!({"jsonrpc":"2.0","id":5,"method":"session/prompt","params":{"sessionId":session,"prompt":[{"type":"text","text":"hold"}]}})).await;
    let mut stopped = vec![client.next().await];
    client
        .send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}}))
        .await;
    loop {
        let frame = client.next().await;
        let done = frame["id"] == 5;
        stopped.push(frame);
        if done {
            break;
        }
    }
    assert_eq!(provider.0.creates.load(Ordering::SeqCst), 1);
    assert_eq!(provider.0.follows.load(Ordering::SeqCst), 2);
    assert!(provider.0.cancels.load(Ordering::SeqCst) >= 1);
    assert_eq!(first.last().unwrap()["result"]["stopReason"], "end_turn");
    assert_eq!(second.last().unwrap()["result"]["stopReason"], "end_turn");
    assert_eq!(stopped.last().unwrap()["result"]["stopReason"], "cancelled");
    insta::assert_json_snapshot!(
        "stdio_messages_followups_stop",
        normalize(
            &json!({"initialize":init,"new":new,"first":first,"followup":second,"stop":stopped}),
            &session
        )
    );
}
#[tokio::test]
async fn stdio_unsupported_inputs_do_not_launch_cloud_work() {
    let provider = Provider::default();
    let mut client = harness(provider.clone(), Journal::default());
    initialize(&mut client).await;
    let new = client
        .call(2, "session/new", json!({"cwd":"/tmp","mcpServers":[]}))
        .await;
    let session = new.last().unwrap()["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let image = client.call(3,"session/prompt",json!({"sessionId":session,"prompt":[{"type":"image","data":"AA==","mimeType":"image/png"}]})).await;
    let empty = client
        .call(
            4,
            "session/prompt",
            json!({"sessionId":session,"prompt":[]}),
        )
        .await;
    let unknown = client
        .call(
            5,
            "session/set_mode",
            json!({"sessionId":session,"modeId":"bypass"}),
        )
        .await;
    assert!(image.last().unwrap().get("error").is_some());
    assert!(empty.last().unwrap().get("error").is_some());
    assert!(unknown.last().unwrap().get("error").is_some());
    assert_eq!(provider.0.creates.load(Ordering::SeqCst), 0);
    insta::assert_json_snapshot!(
        "stdio_unsupported_inputs",
        normalize(
            &json!({"image":image,"empty":empty,"unsupported_mode":unknown}),
            &session
        )
    );
}

#[tokio::test]
async fn stdio_unsupported_elicitation_requests_remote_stop_without_fake_approval() {
    let provider = Provider::default();
    let mut client = harness(provider.clone(), Journal::default());
    initialize(&mut client).await;
    let new = client
        .call(2, "session/new", json!({"cwd":"/tmp","mcpServers":[]}))
        .await;
    let session = new.last().unwrap()["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let frames = client
        .call(
            3,
            "session/prompt",
            json!({"sessionId":session,"prompt":[{"type":"text","text":"elicitation"}]}),
        )
        .await;
    assert!(frames.last().unwrap().get("error").is_some());
    assert_eq!(provider.0.cancels.load(Ordering::SeqCst), 1);
    assert!(
        !frames
            .iter()
            .any(|frame| frame["method"] == "session/request_permission")
    );
    // Keep source-location diagnostics out of fixture identity; the actionable sentence matters.
    let mut frames = normalize(&json!(frames), &session);
    for frame in frames.as_array_mut().unwrap() {
        if let Some(message) = frame.pointer_mut("/error/message") {
            let message_text = message.as_str().unwrap();
            let sentence = message_text
                .lines()
                .find(|line| line.contains("unsupported"))
                .unwrap_or(message_text);
            *message = json!(sentence.trim().trim_start_matches('●').trim());
        }
    }
    insta::assert_json_snapshot!("stdio_unsupported_elicitation", frames);
}

#[tokio::test]
async fn stdio_recorded_cloud_turn_snapshot() {
    let provider = Provider::default();
    let mut client = harness(provider.clone(), Journal::default());
    initialize(&mut client).await;
    let new = client
        .call(2, "session/new", json!({"cwd":"/tmp","mcpServers":[]}))
        .await;
    let session = new.last().unwrap()["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let frames = client
        .call(
            3,
            "session/prompt",
            json!({"sessionId":session,"prompt":[{"type":"text","text":"recorded"}]}),
        )
        .await;
    assert_eq!(frames.last().unwrap()["result"]["stopReason"], "end_turn");
    assert!(frames.iter().any(|frame|frame.pointer("/params/update/sessionUpdate")==Some(&json!("tool_call"))));
    assert!(
        frames
            .iter()
            .any(|frame| frame.pointer("/params/update/sessionUpdate")
                == Some(&json!("agent_message_chunk")))
    );
    assert_eq!(provider.0.creates.load(Ordering::SeqCst), 1);
    insta::assert_json_snapshot!(
        "stdio_recorded_cloud_turn",
        normalize(&json!(frames), &session)
    );
}
