//! Served Codex byte streams folded by the same replacement machine as the app.
use agent_client_protocol::RawJsonRpcMessage;
use agent_fold::domain::{
    fold::{FoldMachineImpl, fold},
    log::{AgentSessionId, AgentSessionLog, Message},
    model::{FoldEvent, FoldedMessage, StopReason},
    ports::FoldMachine as _,
};
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToRuntimeMessage, ToServerMessage};
use codex_cloud_agents::{
    domain::{
        acp_session::{SessionService, SessionStore, StoredSession},
        cloud::{
            CloudEvent, CloudEventStream, CloudId, CreatedTask, ExternalPullRequest, Launch,
            NativeRecord, TaskSnapshot, TurnId, TurnSnapshot,
        },
        journal::{JournalEntry, JournalInput},
        runtime::{CloudRuntime, RuntimeIdentity},
    },
    inbound::acp::serve,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, DuplexStream};

type Result<T> = std::result::Result<T, rootcause::Report>;

#[derive(Clone, Default)]
struct Journal {
    sessions: Arc<Mutex<HashMap<String, StoredSession>>>,
    fail_load: Arc<AtomicBool>,
    entries: Arc<Mutex<HashMap<String, Vec<JournalEntry>>>>,
}
impl SessionStore for Journal {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>> {
        if self.fail_load.load(Ordering::SeqCst) {
            return Err(rootcause::report!("history unavailable"));
        }
        Ok(self.sessions.lock().unwrap().get(id).cloned())
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<()> {
        self.sessions
            .lock()
            .unwrap()
            .insert(id.to_owned(), state.clone());
        Ok(())
    }
    async fn validate(&self) -> Result<()> {
        Ok(())
    }
    async fn read(&self, id: &str) -> Result<Vec<JournalEntry>> {
        Ok(self
            .entries
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .unwrap_or_default())
    }
    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> Result<JournalEntry> {
        let mut entries = self.entries.lock().unwrap();
        let rows = entries.entry(id.into()).or_default();
        if rows.len() as i64 != expected {
            return Err(rootcause::report!("journal sequence conflict"));
        }
        let entry = JournalEntry {
            sequence: expected + 1,
            turn: turn.cloned(),
            input: input.clone(),
        };
        rows.push(entry.clone());
        Ok(entry)
    }
}
#[derive(Default)]
struct Calls {
    prs: Vec<ExternalPullRequest>,
    launches: usize,
    followups: Vec<(String, String, String)>,
    turn: usize,
    holding: bool,
    cancelled: bool,
    final_only: bool,
    late_record: bool,
}
#[derive(Clone, Default)]
struct Runtime(Arc<Mutex<Calls>>);
impl Runtime {
    fn receipt(&self) -> Result<CreatedTask> {
        let mut calls = self.0.lock().unwrap();
        calls.turn += 1;
        calls.cancelled = false;
        Ok(CreatedTask {
            task_id: CloudId::new("task-fold".into())?,
            assistant_turn_id: Some(TurnId::new(format!("turn-{}", calls.turn))?),
            url: "https://chatgpt.com/codex/tasks/task-fold".into(),
        })
    }
    fn state(&self) -> Result<TaskSnapshot> {
        let pull_requests = self.0.lock().unwrap().prs.clone();
        Ok(TaskSnapshot {
            pull_requests,
            task_id: CloudId::new("task-fold".into())?,
            title: None,
            native: None,
            assistant_status: Some({
                let calls = self.0.lock().unwrap();
                if calls.cancelled {
                    "cancelled"
                } else if calls.holding {
                    "in_progress"
                } else {
                    "completed"
                }
                .into()
            }),
            turns: vec![TurnSnapshot {
                source: "current_assistant_turn".into(),
                id: Some(format!("turn-{}", self.0.lock().unwrap().turn)),
                messages: if self.0.lock().unwrap().final_only {
                    vec!["Snapshot answer".into()]
                } else {
                    vec![]
                },
                output_types: vec![],
                has_diff: false,
            }],
        })
    }
}
impl CloudRuntime for Runtime {
    async fn report_pull_request(&self, _: &str) -> Result<()> {
        Ok(())
    }
    async fn identity(&self) -> Result<RuntimeIdentity> {
        Ok(RuntimeIdentity {
            connection_id: "connection-fold".into(),
            account_id: "account-fold".into(),
        })
    }
    async fn resolve_target(
        &self,
        _: &str,
        requested: Option<&codex_cloud_agents::domain::runtime::CloudTarget>,
    ) -> Result<codex_cloud_agents::domain::runtime::CloudTarget> {
        Ok(requested.unwrap().clone())
    }
    async fn launch(&self, request: &Launch) -> Result<CreatedTask> {
        {
            let mut calls = self.0.lock().unwrap();
            calls.launches += 1;
            calls.holding = request.prompt == "hold";
        }
        self.receipt()
    }
    async fn snapshot(&self, _: &CloudId) -> Result<TaskSnapshot> {
        self.state()
    }
    async fn follow_up(&self, task: &CloudId, turn: &TurnId, prompt: &str) -> Result<CreatedTask> {
        self.0.lock().unwrap().holding = prompt == "hold";
        self.0.lock().unwrap().followups.push((
            task.as_str().into(),
            turn.as_str().into(),
            prompt.into(),
        ));
        self.receipt()
    }
    async fn cancel(&self, _: &CloudId) -> Result<()> {
        self.0.lock().unwrap().cancelled = true;
        Ok(())
    }
    async fn turn(&self, _: &CloudId, _: &TurnId) -> Result<TaskSnapshot> {
        self.state()
    }
    async fn stream(&self, _: &CloudId, turn: &TurnId) -> Result<CloudEventStream> {
        if self.0.lock().unwrap().final_only {
            return Ok(Box::pin(futures::stream::empty()));
        }
        let turn = turn.as_str();
        let message = format!("{turn}-message");
        let text = format!("Answer for {turn}");
        let event = CloudEvent {
            id: format!("{turn}-delta"),
            method: "item/agentMessage/delta".into(),
            params: json!({"threadId":"thread-fold","turnId":turn,"itemId":message,"delta":text}),
        };
        if self.0.lock().unwrap().holding {
            use futures::StreamExt as _;
            let event = CloudEvent {
                id: format!("{turn}-thought"),
                method: "item/reasoning/summaryTextDelta".into(),
                params: json!({"delta":"Working"}),
            };
            return Ok(Box::pin(
                futures::stream::iter(vec![
                    Ok(NativeRecord::from_event(CloudEvent {
                        id: format!("{turn}-partial"),
                        method: "item/agentMessage/delta".into(),
                        params: json!({"itemId":message,"delta":"Incomplete answer"}),
                    })),
                    Ok(NativeRecord::from_event(event)),
                ])
                .chain(futures::stream::pending()),
            ));
        }
        let mut records = vec![
            Ok(NativeRecord::from_event(event.clone())),
            Ok(NativeRecord::from_event(event)), // Real reconnect overlap must not duplicate a delta.
            Ok(NativeRecord::from_event(CloudEvent {
                id: format!("{turn}-message-completed"),
                method: "item/completed".into(),
                params: json!({"threadId":"thread-fold","turnId":turn,"item":{"id":message,"type":"agentMessage","text":text}}),
            })),
            Ok(NativeRecord::from_event(CloudEvent {
                id: format!("{turn}-completed"),
                method: "turn/completed".into(),
                params: json!({"threadId":"thread-fold","turn":{"id":turn,"status":"completed"}}),
            })),
        ];
        if self.0.lock().unwrap().late_record {
            records.insert(2, Ok(NativeRecord::from_event(CloudEvent {
                id: format!("{turn}-late"),
                method: "item/completed".into(),
                params: json!({"threadId":"thread-fold","turnId":turn,"item":{"id":format!("{turn}-late-message"),"type":"agentMessage","text":"Late historical answer"}}),
            })));
        }
        Ok(Box::pin(futures::stream::iter(records)))
    }
}

struct Client {
    read: BufReader<tokio::io::ReadHalf<DuplexStream>>,
    write: tokio::io::WriteHalf<DuplexStream>,
    server: tokio::task::JoinHandle<()>,
}
impl Client {
    fn new(runtime: Runtime, journal: Journal) -> Self {
        Self::with_reload(runtime, journal, None)
    }
    fn with_reload(
        runtime: Runtime,
        journal: Journal,
        reload: Option<
            tokio::sync::mpsc::UnboundedSender<agent_client_protocol::schema::v1::SessionId>,
        >,
    ) -> Self {
        let service = Arc::new(SessionService::new(
            Arc::new(runtime),
            journal,
            Some(codex_cloud_agents::domain::runtime::CloudTarget {
                environment: CloudId::new("environment-fold".into()).unwrap(),
                branch: "main".into(),
                repository_url: Some("https://github.com/org/repo".into()),
            }),
        ));
        let (client, agent) = tokio::io::duplex(128 * 1024);
        let (read, write) = tokio::io::split(client);
        let (input, output) = tokio::io::split(agent);
        let server = tokio::spawn(async move {
            let _ = serve(service, input, output, reload).await;
        });
        Self {
            read: BufReader::new(read),
            write,
            server,
        }
    }
    async fn call(
        &mut self,
        log: &mut Vec<AgentSessionLog>,
        id: u64,
        method: &str,
        params: Value,
    ) -> Vec<Value> {
        let request = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
        self.send(log, request).await;
        self.collect(log, id).await
    }
    async fn send(&mut self, log: &mut Vec<AgentSessionLog>, request: Value) {
        log.push(entry(true, request.clone()));
        self.write
            .write_all(format!("{request}\n").as_bytes())
            .await
            .unwrap();
        self.write.flush().await.unwrap();
    }
    async fn collect(&mut self, log: &mut Vec<AgentSessionLog>, id: u64) -> Vec<Value> {
        let mut frames = Vec::new();
        loop {
            let mut line = String::new();
            let count =
                tokio::time::timeout(Duration::from_secs(10), self.read.read_line(&mut line))
                    .await
                    .expect("ACP timed out")
                    .unwrap();
            assert_ne!(count, 0, "ACP closed before response");
            let frame: Value = serde_json::from_str(&line).expect("clean JSON stdout");
            log.push(entry(false, frame.clone()));
            let done = frame["id"] == id;
            frames.push(frame);
            if done {
                return frames;
            }
        }
    }
    async fn initialize(&mut self, log: &mut Vec<AgentSessionLog>) -> Value {
        self.call(
            log,
            1,
            "initialize",
            json!({"protocolVersion":1,"clientCapabilities":{}}),
        )
        .await
        .pop()
        .unwrap()
    }
    async fn session(&mut self, log: &mut Vec<AgentSessionLog>) -> String {
        self.call(
            log,
            2,
            "session/new",
            json!({"cwd":"/workspace","mcpServers":[]}),
        )
        .await
        .last()
        .unwrap()["result"]["sessionId"]
            .as_str()
            .unwrap()
            .into()
    }
    async fn prompt(&mut self, log: &mut Vec<AgentSessionLog>, session: &str, id: u64, text: &str) {
        let frames = self
            .call(
                log,
                id,
                "session/prompt",
                json!({"sessionId":session,"prompt":[{"type":"text","text":text}]}),
            )
            .await;
        assert_eq!(frames.last().unwrap()["result"]["stopReason"], "end_turn");
    }
    async fn load(&mut self, log: &mut Vec<AgentSessionLog>, session: &str, id: u64) -> Vec<Value> {
        self.call(
            log,
            id,
            "session/load",
            json!({"sessionId":session,"cwd":"/workspace","mcpServers":[]}),
        )
        .await
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.server.abort();
    }
}
fn entry(to_runtime: bool, value: Value) -> AgentSessionLog {
    let frame: RawJsonRpcMessage = serde_json::from_value(value).unwrap();
    AgentSessionLog {
        agent_session_id: AgentSessionId::new_from_uuid(uuid::Uuid::from_u128(0xA)),
        user_id: None,
        content: if to_runtime {
            Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(frame)))
        } else {
            Message::ToServer(ToServerMessage::Acp(AcpMessage(frame)))
        },
    }
}
fn assert_fold(log: &[AgentSessionLog]) -> Vec<FoldedMessage> {
    let mut machine = FoldMachineImpl::new();
    let mut visible: Vec<FoldedMessage> = vec![];
    for (index, entry) in log.iter().enumerate() {
        for event in machine.push(entry.clone()) {
            match event {
                FoldEvent::MessagesReplaced(messages) => visible = messages.into_owned(),
                FoldEvent::NewMessage(message) => visible.push(message.into_owned()),
                FoldEvent::MessageUpdate(message) => {
                    let position = visible
                        .iter()
                        .position(|old| old.id() == message.id())
                        .unwrap();
                    visible[position] = message.into_owned();
                }
                FoldEvent::MetadataUpdated(_) => {}
            }
        }
        assert_eq!(visible, machine.messages(), "machine prefix {index}");
        assert_eq!(
            visible,
            fold(log[..=index].iter().cloned()),
            "batch prefix {index}"
        );
    }
    visible
}
fn assert_turns(messages: &[FoldedMessage], turns: usize) {
    assert_eq!(
        messages.len(),
        turns * 2,
        "exactly one user and agent message per turn"
    );
    assert_eq!(
        messages
            .iter()
            .filter(|message| message.stop == Some(StopReason::EndTurn))
            .count(),
        turns,
        "one successful outcome per turn"
    );
    for (index, message) in messages.iter().enumerate() {
        assert_eq!(message.id.0 as usize, index / 2);
    }
}

#[tokio::test]
async fn recorded_missing_deltas_replay_restores_both_answers_once() {
    let runtime = Runtime::default();
    let journal = Journal::default();
    let mut client = Client::new(runtime.clone(), journal.clone());
    let mut log = vec![];
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    let recording: Vec<JournalEntry> =
        serde_json::from_str(include_str!("fixtures/missing_live_deltas.json")).unwrap();
    journal
        .entries
        .lock()
        .unwrap()
        .insert(session.clone(), recording);
    drop(client);

    let mut client = Client::new(runtime.clone(), journal);
    client.initialize(&mut log).await;
    let loaded = client.load(&mut log, &session, 3).await;
    assert!(loaded.last().unwrap().get("result").is_some());
    let messages = assert_fold(&log);
    assert_turns(&messages, 2);
    insta::assert_json_snapshot!("recorded_missing_deltas_replay", messages);
    let serialized = serde_json::to_string(&messages).unwrap();
    assert!(!serialized.contains("Final provider output"));
    assert!(!serialized.contains("Corrected provider message"));
    assert_eq!(serialized.matches("My name is **Codex**").count(), 1);
    assert_eq!(serialized.matches("## Hey! 👋").count(), 1);

    for request_id in [4, 5] {
        assert!(
            client
                .load(&mut log, &session, request_id)
                .await
                .last()
                .unwrap()
                .get("result")
                .is_some()
        );
        assert_eq!(
            assert_fold(&log),
            messages,
            "reloading must replace the transcript without duplicating text"
        );
    }
    assert_eq!(runtime.0.lock().unwrap().launches, 0);
}

#[tokio::test]
async fn partial_answer_is_withheld_while_working_and_final_snapshot_appears_once() {
    let runtime = Runtime::default();
    let mut client = Client::new(runtime.clone(), Journal::default());
    let mut log = Vec::new();
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    client
        .send(
            &mut log,
            json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{
                "sessionId":session,"prompt":[{"type":"text","text":"hold"}]
            }}),
        )
        .await;
    loop {
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(2), client.read.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        let frame: Value = serde_json::from_str(&line).unwrap();
        assert!(frame.get("id").is_none(), "prompt must still be running");
        assert_ne!(
            frame["params"]["update"]["sessionUpdate"],
            "agent_message_chunk"
        );
        log.push(entry(false, frame.clone()));
        if frame["params"]["update"]["sessionUpdate"] == "agent_thought_chunk" {
            break;
        }
    }
    assert!(
        !serde_json::to_string(&assert_fold(&log))
            .unwrap()
            .contains("Incomplete answer")
    );
    {
        let mut calls = runtime.0.lock().unwrap();
        calls.holding = false;
        calls.final_only = true;
    }
    client.collect(&mut log, 3).await;
    let messages = assert_fold(&log);
    assert_turns(&messages, 1);
    let text = serde_json::to_string(&messages).unwrap();
    assert!(!text.contains("Incomplete answer"));
    assert_eq!(text.matches("Snapshot answer").count(), 1);
    client.load(&mut log, &session, 4).await;
    assert_eq!(assert_fold(&log), messages);
}

#[tokio::test]
async fn load_is_advertised_and_resume_is_not_implemented() {
    let mut client = Client::new(Runtime::default(), Journal::default());
    let mut log = vec![];
    let init = client.initialize(&mut log).await;
    assert_eq!(init["result"]["agentCapabilities"]["loadSession"], true);
    assert!(init["result"]["agentCapabilities"]["sessionCapabilities"]["resume"].is_null());
    let resumed = client
        .call(
            &mut log,
            3,
            "session/resume",
            json!({"sessionId":"not-a-session","cwd":"/workspace","mcpServers":[]}),
        )
        .await;
    assert!(resumed.last().unwrap().get("error").is_some());
}

#[tokio::test]
async fn actual_live_reload_and_immediate_followup_replace_without_duplicate_turns() {
    let runtime = Runtime::default();
    let journal = Journal::default();
    let mut client = Client::new(runtime.clone(), journal.clone());
    let mut log = vec![];
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    client.prompt(&mut log, &session, 3, "First question").await;
    let first = assert_fold(&log);
    assert_turns(&first, 1);
    drop(client);
    let mut client = Client::new(runtime.clone(), journal);
    client.initialize(&mut log).await;
    for id in [4, 5] {
        let loaded = client.load(&mut log, &session, id).await;
        assert!(loaded.last().unwrap().get("result").is_some());
        assert_eq!(
            assert_fold(&log),
            first,
            "actual successful loads replace original messages"
        );
    }
    // No sleep: the immediately following request must observe released recovery ownership.
    client
        .prompt(&mut log, &session, 6, "Second question")
        .await;
    let second = assert_fold(&log);
    assert_turns(&second, 2);
    assert!(
        client
            .load(&mut log, &session, 7)
            .await
            .last()
            .unwrap()
            .get("result")
            .is_some()
    );
    assert_eq!(assert_fold(&log), second);
    let calls = runtime.0.lock().unwrap();
    assert_eq!(calls.launches, 1);
    assert_eq!(
        calls.followups,
        vec![(
            "task-fold".into(),
            "turn-1".into(),
            "Second question".into()
        )]
    );
}

#[tokio::test]
async fn incomplete_and_failed_actual_loads_preserve_prior_committed_messages() {
    let runtime = Runtime::default();
    let journal = Journal::default();
    let mut client = Client::new(runtime.clone(), journal.clone());
    let mut committed = vec![];
    client.initialize(&mut committed).await;
    let session = client.session(&mut committed).await;
    client
        .prompt(&mut committed, &session, 3, "Old question")
        .await;
    let old = assert_fold(&committed);
    // The durable conversation advances while this observer still shows the old turn.
    client
        .prompt(&mut vec![], &session, 4, "Newer question")
        .await;
    drop(client);
    let mut client = Client::new(runtime.clone(), journal.clone());
    client.initialize(&mut vec![]).await;
    let mut candidate = vec![];
    let loaded = client.load(&mut candidate, &session, 5).await;
    assert!(loaded.last().unwrap().get("result").is_some());
    let response = candidate.pop().unwrap();
    let mut interrupted = committed.clone();
    for frame in candidate {
        interrupted.push(frame);
        assert_eq!(
            assert_fold(&interrupted),
            old,
            "unacknowledged replay stays hidden"
        );
    }
    interrupted.push(response);
    assert_turns(&assert_fold(&interrupted), 2);
    drop(client);
    journal.fail_load.store(true, Ordering::SeqCst);
    let mut client = Client::new(runtime.clone(), journal.clone());
    client.initialize(&mut committed).await;
    let failed = client.load(&mut committed, &session, 6).await;
    assert!(failed.last().unwrap().get("error").is_some());
    assert_eq!(
        assert_fold(&committed),
        old,
        "failed load preserves the old conversation"
    );
    drop(client);
    journal.fail_load.store(false, Ordering::SeqCst);
    journal
        .entries
        .lock()
        .unwrap()
        .get_mut(&session)
        .unwrap()
        .remove(0);
    let mut client = Client::new(runtime, journal);
    client.initialize(&mut committed).await;
    let missing_boundary = client.load(&mut committed, &session, 7).await;
    assert!(
        missing_boundary.last().unwrap().get("error").is_some(),
        "native history without a complete beginning cannot be loaded"
    );
    assert_eq!(assert_fold(&committed), old);
}

#[tokio::test]
async fn cancelled_live_turn_keeps_one_cancelled_outcome_after_reload() {
    let runtime = Runtime::default();
    let journal = Journal::default();
    let mut client = Client::new(runtime.clone(), journal.clone());
    let mut log = vec![];
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    client.send(&mut log, json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":session,"prompt":[{"type":"text","text":"hold"}]}})).await;
    loop {
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(10), client.read.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        let frame: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(frame["method"], "session/update");
        let assistant = frame["params"]["update"]["sessionUpdate"] == "agent_thought_chunk";
        log.push(entry(false, frame));
        if assistant {
            break;
        }
    }
    client
        .send(
            &mut log,
            json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}}),
        )
        .await;
    let stopped = client.collect(&mut log, 3).await;
    assert_eq!(stopped.last().unwrap()["result"]["stopReason"], "cancelled");
    let messages = assert_fold(&log);
    assert_eq!(
        messages.len(),
        3,
        "live fold includes the accepted stop control"
    );
    assert_eq!(messages[1].stop, Some(StopReason::Cancelled));
    drop(client);
    let mut client = Client::new(runtime.clone(), journal);
    client.initialize(&mut log).await;
    assert!(
        client
            .load(&mut log, &session, 4)
            .await
            .last()
            .unwrap()
            .get("result")
            .is_some()
    );
    let replayed = assert_fold(&log);
    assert_eq!(
        replayed,
        messages[..2],
        "replay preserves conversation and cancellation outcome"
    );
    assert_eq!(runtime.0.lock().unwrap().launches, 1);
}

#[tokio::test]
async fn snapshot_only_answer_survives_repeated_loads_once() {
    let runtime = Runtime::default();
    runtime.0.lock().unwrap().final_only = true;
    let journal = Journal::default();
    let mut client = Client::new(runtime.clone(), journal.clone());
    let mut log = vec![];
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    client
        .prompt(&mut log, &session, 3, "Snapshot question")
        .await;
    let original = assert_fold(&log);
    assert_turns(&original, 1);
    drop(client);
    let mut client = Client::new(runtime.clone(), journal);
    client.initialize(&mut log).await;
    for id in 4..8 {
        assert!(
            client
                .load(&mut log, &session, id)
                .await
                .last()
                .unwrap()
                .get("result")
                .is_some()
        );
        assert_eq!(assert_fold(&log), original);
    }
    assert_eq!(runtime.0.lock().unwrap().launches, 1);
}

#[tokio::test]
async fn late_historical_records_are_silent_until_replacement_load() {
    let runtime = Runtime::default();
    let journal = Journal::default();
    let mut client = Client::new(runtime.clone(), journal.clone());
    let mut log = vec![];
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    client.prompt(&mut log, &session, 3, "Question").await;
    let original = assert_fold(&log);
    drop(client);
    runtime.0.lock().unwrap().late_record = true;
    let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
    let mut client = Client::with_reload(runtime.clone(), journal, Some(send));
    client.initialize(&mut log).await;
    assert!(
        client
            .load(&mut log, &session, 4)
            .await
            .last()
            .unwrap()
            .get("result")
            .is_some()
    );
    assert_eq!(assert_fold(&log), original);
    let requested = tokio::time::timeout(Duration::from_secs(10), receive.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(requested.to_string(), session);
    let mut unsolicited = String::new();
    assert!(
        tokio::time::timeout(
            Duration::from_millis(50),
            client.read.read_line(&mut unsolicited)
        )
        .await
        .is_err(),
        "historical recovery must not append ACP activity: {unsolicited}"
    );
    assert!(
        client
            .load(&mut log, &session, 5)
            .await
            .last()
            .unwrap()
            .get("result")
            .is_some()
    );
    let replaced = assert_fold(&log);
    assert_ne!(
        replaced, original,
        "successful reload includes newly recovered native history"
    );
    assert_turns(&replaced, 1);
    assert_eq!(replaced[1].stop, Some(StopReason::EndTurn));
    assert!(
        client
            .load(&mut log, &session, 6)
            .await
            .last()
            .unwrap()
            .get("result")
            .is_some()
    );
    assert_eq!(assert_fold(&log), replaced);
    assert_eq!(runtime.0.lock().unwrap().launches, 1);
}

fn associated_pr(turn: &str, repo: &str, number: u32) -> ExternalPullRequest {
    ExternalPullRequest {
        assistant_turn_id: TurnId::new(turn.into()).unwrap(),
        url: format!("https://github.com/{repo}/pull/{number}"),
    }
}

#[tokio::test]
async fn verified_pr_is_a_standard_completed_tool_in_live_and_replayed_history() {
    let runtime = Runtime::default();
    runtime.0.lock().unwrap().prs = vec![
        associated_pr("turn-1", "org/repo", 42),
        associated_pr("turn-1", "other/repo", 99),
        associated_pr("foreign-turn", "org/repo", 98),
    ];
    let mut client = Client::new(runtime.clone(), Journal::default());
    let mut log = vec![];
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    client
        .prompt(&mut log, &session, 3, "Inspect repository")
        .await;
    let messages = assert_fold(&log);
    assert_turns(&messages, 1);
    let serialized = serde_json::to_string(&messages).unwrap();
    assert_eq!(serialized.matches("Found pull request").count(), 1);
    assert!(serialized.contains("https://github.com/org/repo/pull/42"));
    assert!(!serialized.contains("other/repo"));
    assert!(!serialized.contains("/pull/98"));
    insta::assert_json_snapshot!("verified_pr_tool", messages);
    for id in [4, 5] {
        client.load(&mut log, &session, id).await;
        assert_eq!(assert_fold(&log), messages);
    }
    assert_eq!(runtime.0.lock().unwrap().launches, 1);
}

#[tokio::test]
async fn late_pr_metadata_replays_on_its_own_turn_without_duplicate_tools() {
    let runtime = Runtime::default();
    let journal = Journal::default();
    let mut client = Client::new(runtime.clone(), journal.clone());
    let mut log = vec![];
    client.initialize(&mut log).await;
    let session = client.session(&mut log).await;
    client.prompt(&mut log, &session, 3, "First turn").await;
    client.prompt(&mut log, &session, 4, "Second turn").await;
    drop(client);
    let mut snapshot = runtime.state().unwrap();
    snapshot.pull_requests = vec![associated_pr("turn-1", "org/repo", 42)];
    let sequence = journal.read(&session).await.unwrap().len() as i64;
    journal
        .append(
            &session,
            sequence,
            None,
            &JournalInput::Metadata {
                snapshot,
                native: None,
            },
        )
        .await
        .unwrap();
    let mut client = Client::new(runtime.clone(), journal);
    client.initialize(&mut log).await;
    client.load(&mut log, &session, 5).await;
    let messages = assert_fold(&log);
    assert_turns(&messages, 2);
    assert!(
        serde_json::to_string(&messages[1])
            .unwrap()
            .contains("Found pull request")
    );
    assert!(
        !serde_json::to_string(&messages[3])
            .unwrap()
            .contains("Found pull request")
    );
    for id in [6, 7] {
        client.load(&mut log, &session, id).await;
        assert_eq!(assert_fold(&log), messages);
    }
    assert_eq!(runtime.0.lock().unwrap().launches, 1);
    assert_eq!(runtime.0.lock().unwrap().followups.len(), 1);
}
