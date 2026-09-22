use super::*;
use agent_fold::domain::service::FoldedMessageService;
use agent_session::domain::{
    model::{Message, ReplicaId},
    ports::{
        NoOpAgentSessionNameGenerator, NoOpRealtime, NoOpTurnObserver, NoopLifecyclePublisher,
    },
    service::AgentSessionServiceImpl,
};
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Notify;

mod socket;

type Sessions = AgentSessionServiceImpl<
    InMemoryAgentSessionRepo,
    FoldedMessageService<InMemoryAgentSessionRepo>,
    NoOpRealtime,
>;

#[derive(Default)]
struct Tools {
    calls: AtomicUsize,
    entered: Notify,
    finish: Notify,
}

#[async_trait::async_trait]
impl WorkerToolSession for Tools {
    fn configuration(&self) -> Value {
        json!({"instructions":"test", "tools":[]})
    }
    fn handle_response(&self, _: &RawJsonRpcMessage) -> bool {
        false
    }
    async fn record_usage(&self, _: String, _: u64, _: u64) {}
    async fn call(
        &self,
        _: String,
        _: String,
        _: Value,
        cancel: CancellationToken,
        review_cancel: CancellationToken,
    ) -> anyhow::Result<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.notify_one();
        self.finish.notified().await;
        Ok(
            json!({"output":{"committed":true, "workCancelled":cancel.is_cancelled(), "reviewCancelled":review_cancel.is_cancelled()}, "isError":false, "loadedTools":[]}),
        )
    }
}

async fn attached() -> (
    Arc<Sessions>,
    AgentSessionId,
    Uuid,
    Channel<ToServerMessage, ToRuntimeMessage>,
) {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    repo.insert_session(test_agent_session(id));
    let sessions = Arc::new(AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    ));
    let generation = macro_uuid::generate_uuid_v7();
    let (server, runtime) = Channel::duplex();
    sessions
        .attach_session(id, RuntimeAttachment::solo(server).generation(generation))
        .await
        .unwrap();
    (sessions, id, generation, runtime)
}

async fn open(
    sessions: &Sessions,
    id: AgentSessionId,
    generation: Uuid,
    runtime: &mut Channel<ToServerMessage, ToRuntimeMessage>,
) {
    sessions
        .record_runtime_frame(
            id,
            generation,
            serde_json::from_value(json!({"type":"event","event":"acp_ready"})).unwrap(),
        )
        .await
        .unwrap();
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(init))) =
        runtime.rx.recv().await.unwrap()
    else {
        panic!("initialize")
    };
    sessions
        .record_runtime_frame(
            id,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                init.id,
                Ok(json!({"protocolVersion":1,"agentCapabilities":{}})),
            ))),
        )
        .await
        .unwrap();
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) =
        runtime.rx.recv().await.unwrap()
    else {
        panic!("new")
    };
    sessions
        .record_runtime_frame(
            id,
            generation,
            ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::response(
                request.id,
                Ok(json!({"sessionId":"voice"})),
            ))),
        )
        .await
        .unwrap();
    sessions
        .record_native_turn(
            id,
            generation,
            macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
            AgentActionId::mint(),
            "Run the tool".into(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn failed_canonical_admission_never_executes_a_tool() {
    let (sessions, id, generation, _runtime) = attached().await;
    let tools = Arc::new(Tools::default());
    let mut jobs = tokio::task::JoinSet::new();
    let calls = Arc::new(Mutex::new(HashMap::new()));
    let (outbox, _results) = tokio::sync::mpsc::unbounded_channel();
    let result = start_tool_call(
        &mut jobs,
        &calls,
        tools.clone(),
        &outbox,
        sessions.clone(),
        id,
        macro_uuid::generate_uuid_v7(),
        "voice",
        &json!({"callId":"effect-1","name":"SendEmail","arguments":{}}),
        CancellationToken::new(),
    )
    .await;
    assert!(result.is_err());
    assert!(jobs.is_empty());
    assert_eq!(tools.calls.load(Ordering::SeqCst), 0);
    assert!(sessions.session_log(id).await.unwrap().entries.is_empty());
    sessions.close_runtime(id, generation).await.unwrap();
}

#[tokio::test]
async fn interruption_and_a_lost_result_receiver_preserve_the_committed_tool_ledger() {
    let (sessions, id, generation, mut runtime) = attached().await;
    open(&sessions, id, generation, &mut runtime).await;
    let tools = Arc::new(Tools::default());
    let mut jobs = tokio::task::JoinSet::new();
    let calls = Arc::new(Mutex::new(HashMap::new()));
    let (outbox, results) = tokio::sync::mpsc::unbounded_channel();
    let review = CancellationToken::new();
    let call = json!({"callId":"effect-1","name":"SendEmail","arguments":{"subject":"Confirmed"}});
    start_tool_call(
        &mut jobs,
        &calls,
        tools.clone(),
        &outbox,
        sessions.clone(),
        id,
        generation,
        "voice",
        &call,
        review.clone(),
    )
    .await
    .unwrap();
    tools.entered.notified().await;
    let started = sessions.session_log(id).await.unwrap();
    assert!(started.entries.iter().any(|entry| {
        serde_json::to_value(&entry.entry.content)
            .unwrap()
            .to_string()
            .contains("in_progress")
    }));
    // Same provider receipt cannot run a product effect again, even while the
    // first response is outstanding.
    start_tool_call(
        &mut jobs,
        &calls,
        tools.clone(),
        &outbox,
        sessions.clone(),
        id,
        generation,
        "voice",
        &call,
        review.clone(),
    )
    .await
    .unwrap();
    assert_eq!(tools.calls.load(Ordering::SeqCst), 1);
    drop(results);
    review.cancel();
    tools.finish.notify_one();
    while let Some(job) = jobs.join_next().await {
        job.unwrap();
    }
    let result = calls.lock().unwrap()["effect-1"].result.clone().unwrap();
    assert_eq!(result["output"]["workCancelled"], false);
    assert_eq!(result["output"]["reviewCancelled"], true);
    let updates: Vec<_> = sessions
        .session_log(id)
        .await
        .unwrap()
        .entries
        .into_iter()
        .filter_map(|entry| match entry.entry.content {
            Message::ToServer(ToServerMessage::Acp(AcpMessage(
                RawJsonRpcMessage::Notification(notification),
            ))) if notification.method.as_ref() == "session/update" => {
                Some(serde_json::to_value(notification.params).unwrap())
            }
            _ => None,
        })
        .collect();
    assert_eq!(updates.len(), 2);
    assert_eq!(updates[1]["update"]["status"], "completed");
    assert_eq!(updates[1]["update"]["rawOutput"]["committed"], true);
    sessions.close_runtime(id, generation).await.unwrap();
}
