use super::*;
use agent_session::testing::test_agent_session;
use code_execution::domain::{CallId, RunId};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct MemoryStore(Mutex<HashMap<(AgentSessionId, String), ExecutionRecord>>);

#[async_trait]
impl ExecutionStore for MemoryStore {
    async fn create(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        let mut records = self.0.lock().unwrap();
        let key = (session, record.execution_id.to_string());
        if records.contains_key(&key) {
            return Err(CodeModeError::Duplicate);
        }
        records.insert(key, record.clone());
        Ok(())
    }
    async fn save(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .insert((session, record.execution_id.to_string()), record.clone());
        Ok(())
    }
    async fn get(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .get(&(session, execution.to_string()))
            .cloned()
            .ok_or(CodeModeError::NotFound)
    }
}

struct TestTurns(Mutex<Option<macro_uuid::Uuid>>);
impl Default for TestTurns {
    fn default() -> Self {
        Self(Mutex::new(Some(macro_uuid::Uuid::from_u128(1))))
    }
}
#[async_trait]
impl ExecutionTurns for TestTurns {
    async fn active(&self, _: AgentSessionId) -> Result<Option<macro_uuid::Uuid>, CodeModeError> {
        Ok(*self.0.lock().unwrap())
    }
}

#[derive(Default)]
struct TestTools(Mutex<Vec<(String, String)>>);

#[async_trait]
impl CodeModeTools for TestTools {
    fn catalog(&self) -> Vec<ToolDocumentation> {
        ["NameSearch", "SendEmail", "Subagent"]
            .into_iter()
            .map(|name| ToolDocumentation {
                name: name.into(),
                description: name.into(),
                input_schema: json!({"type": "object"}),
                output_schema: json!({"type": "object"}),
                user_tool: name == "SendEmail",
            })
            .collect()
    }
    async fn call(
        &self,
        identity: &ExecutionIdentity,
        name: &str,
        args: &Value,
        _cancel: CancellationToken,
    ) -> HostResult {
        self.0
            .lock()
            .unwrap()
            .push((identity.owner.to_string(), name.into()));
        HostResult::Ok {
            value: json!({"results": [args["name"]]}),
        }
    }
}

struct TestExecutor;

#[async_trait]
impl ProgramExecutor for TestExecutor {
    async fn execute_program(
        &self,
        request: ExecuteRequest,
        dispatcher: Arc<dyn HostDispatcher>,
        cancellation: CancellationToken,
    ) -> Outcome {
        let (progress, _) = tokio::sync::mpsc::channel(1);
        let result = dispatcher
            .dispatch(
                HostCall {
                    id: CallId(1),
                    method: request.source,
                    args: json!({"name": "launch"}),
                },
                DispatchContext {
                    run_id: RunId(uuid::Uuid::now_v7()),
                    cancellation,
                    progress: Some(progress),
                },
            )
            .await;
        match result {
            HostResult::Ok { .. } => Outcome::Succeeded {
                value: json!({"count": 1}),
            },
            HostResult::Error { message } => code_execution::domain::ExecutionFailure::new(
                code_execution::domain::FailureCode::Runtime,
                message,
            )
            .into(),
        }
    }
}

fn service() -> (CodeModeService, Arc<TestTools>, Arc<MemoryStore>) {
    let tools = Arc::new(TestTools::default());
    let store = Arc::new(MemoryStore::default());
    (
        CodeModeService::new(
            Some(Arc::new(TestExecutor)),
            tools.clone(),
            store.clone(),
            Arc::new(TestTurns::default()),
        ),
        tools,
        store,
    )
}

fn request(method: &str) -> ExecuteRequest {
    ExecuteRequest {
        source: method.into(),
        timeout_ms: 1000,
    }
}

#[tokio::test]
async fn model_gets_selected_json_while_ui_retains_real_calls_and_owner() {
    let (service, tools, store) = service();
    let session = test_agent_session(AgentSessionId::TEST_A);
    let result = service
        .execute(
            &session,
            ExecutionId::mint(),
            request("NameSearch"),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.result, Some(json!({"count": 1})));
    assert!(
        serde_json::to_value(&result)
            .unwrap()
            .get("calls")
            .is_none()
    );
    let record = store.get(session.id, result.execution_id).await.unwrap();
    assert_eq!(record.calls.len(), 1);
    assert_eq!(record.calls[0].name, "NameSearch");
    assert_eq!(record.calls[0].output, Some(json!({"results": ["launch"]})));
    assert_eq!(record.calls[0].status, RecordedCallStatus::Completed);
    assert_eq!(
        tools.0.lock().unwrap()[0].0,
        session.owner_user().unwrap().to_string()
    );
    let other = EntityAccessReceipt::dangerously_assert_internal_user(
        &AgentSessionId::TEST_B.as_uuid().to_string(),
        EntityType::AgentSession,
    );
    assert!(matches!(
        service.read(&other, result.execution_id).await,
        Err(CodeModeError::NotFound)
    ));
}

#[tokio::test]
async fn sdk_policy_matches_discovery_and_rejects_interactive_and_recursive_calls() {
    let (service, tools, _) = service();
    assert_eq!(
        service
            .describe(&[])
            .unwrap()
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>(),
        ["NameSearch"]
    );
    assert!(service.describe(&["Subagent".into()]).is_err());
    let session = test_agent_session(AgentSessionId::TEST_A);
    for name in ["SendEmail", "Subagent", "ExecuteCode", "Unknown"] {
        let result = service
            .execute(
                &session,
                ExecutionId::mint(),
                request(name),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(result.status, ExecutionStatus::Failed);
    }
    assert!(tools.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn archived_sessions_and_invalid_sources_are_rejected_before_storage() {
    let (service, _, store) = service();
    let mut session = test_agent_session(AgentSessionId::TEST_A);
    session.is_archived = true;
    assert!(matches!(
        service
            .execute(
                &session,
                ExecutionId::mint(),
                request("NameSearch"),
                CancellationToken::new()
            )
            .await,
        Err(CodeModeError::Forbidden)
    ));
    session.is_archived = false;
    assert!(matches!(
        service
            .execute(
                &session,
                ExecutionId::mint(),
                request(""),
                CancellationToken::new()
            )
            .await,
        Err(CodeModeError::Invalid(_))
    ));
    assert!(store.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_completed_write_keeps_its_outcome_when_output_is_too_large() {
    let (service, _, store) = service();
    let session = test_agent_session(AgentSessionId::TEST_A);
    let record = ExecutionRecord {
        execution_id: ExecutionId::mint(),
        source: "return null".into(),
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: Vec::new(),
    };
    store.create(session.id, &record).await.unwrap();
    let dispatcher = RecordingDispatcher {
        inner: service.0.clone(),
        identity: ExecutionIdentity {
            session: session.id,
            owner: session.owner_user().unwrap().clone(),
            bot: session.bot_id,
            turn: macro_uuid::Uuid::from_u128(1),
        },
        record: tokio::sync::Mutex::new(record),
        cancel: CancellationToken::new(),
    };
    let call = HostCall {
        id: CallId(1),
        method: "NameSearch".into(),
        args: json!({"name": "launch"}),
    };
    let id = dispatcher.begin(&call).await.unwrap();
    dispatcher
        .finish(
            &id,
            &HostResult::Ok {
                value: json!("x".repeat(MAX_RECORD_BYTES)),
            },
        )
        .await
        .unwrap();
    let record = dispatcher.record.lock().await;
    assert_eq!(record.calls[0].status, RecordedCallStatus::Completed);
    assert!(record.calls[0].output_omitted);
    assert_eq!(record.calls[0].output, None);
    assert!(record_size(&record).unwrap() < MAX_RECORD_BYTES);
}

struct CancelledExecutor {
    started: Arc<tokio::sync::Notify>,
}
#[async_trait]
impl ProgramExecutor for CancelledExecutor {
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: Arc<dyn HostDispatcher>,
        cancel: CancellationToken,
    ) -> Outcome {
        self.started.notify_one();
        cancel.cancelled().await;
        Outcome::Cancelled
    }
}

#[tokio::test]
async fn dropping_the_request_cancels_execution_and_finishes_the_journal() {
    let started = Arc::new(tokio::sync::Notify::new());
    let store = Arc::new(MemoryStore::default());
    let service = CodeModeService::new(
        Some(Arc::new(CancelledExecutor {
            started: started.clone(),
        })),
        Arc::new(TestTools::default()),
        store.clone(),
        Arc::new(TestTurns::default()),
    );
    let task = tokio::spawn(async move {
        service
            .execute(
                &test_agent_session(AgentSessionId::TEST_A),
                ExecutionId::mint(),
                request("NameSearch"),
                CancellationToken::new(),
            )
            .await
    });
    started.notified().await;
    task.abort();
    assert!(matches!(task.await, Err(error) if error.is_cancelled()));
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if store
                .0
                .lock()
                .unwrap()
                .values()
                .any(|record| record.status == ExecutionStatus::Cancelled)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("detached cleanup persists cancellation");
}

#[tokio::test]
async fn persistence_failure_prevents_tool_dispatch() {
    struct DownStore;
    #[async_trait]
    impl ExecutionStore for DownStore {
        async fn create(
            &self,
            _: AgentSessionId,
            _: &ExecutionRecord,
        ) -> Result<(), CodeModeError> {
            Ok(())
        }
        async fn save(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
            Err(CodeModeError::Storage(rootcause::report!("storage down")))
        }
        async fn get(
            &self,
            _: AgentSessionId,
            _: ExecutionId,
        ) -> Result<ExecutionRecord, CodeModeError> {
            Err(CodeModeError::NotFound)
        }
    }
    let tools = Arc::new(TestTools::default());
    let service = CodeModeService::new(
        Some(Arc::new(TestExecutor)),
        tools.clone(),
        Arc::new(DownStore),
        Arc::new(TestTurns::default()),
    );
    assert!(
        service
            .execute(
                &test_agent_session(AgentSessionId::TEST_A),
                ExecutionId::mint(),
                request("NameSearch"),
                CancellationToken::new()
            )
            .await
            .is_err()
    );
    assert!(tools.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reusing_an_execution_id_never_replays_tools() {
    let (service, tools, _) = service();
    let session = test_agent_session(AgentSessionId::TEST_A);
    let id = ExecutionId::mint();
    let first = service
        .execute(
            &session,
            id,
            request("NameSearch"),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    let second = service
        .execute(
            &session,
            id,
            request("NameSearch"),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(first.result, second.result);
    assert_eq!(tools.0.lock().unwrap().len(), 1);
    assert!(matches!(
        service
            .execute(
                &session,
                id,
                request("Different source"),
                CancellationToken::new()
            )
            .await,
        Err(CodeModeError::Duplicate)
    ));
}

#[tokio::test]
async fn shared_turn_changes_cancel_execution_without_mcp_cancellation() {
    for next in [None, Some(macro_uuid::Uuid::from_u128(2))] {
        let started = Arc::new(tokio::sync::Notify::new());
        let turns = Arc::new(TestTurns::default());
        let store = Arc::new(MemoryStore::default());
        let service = CodeModeService::new(
            Some(Arc::new(CancelledExecutor {
                started: started.clone(),
            })),
            Arc::new(TestTools::default()),
            store.clone(),
            turns.clone(),
        );
        let id = ExecutionId::mint();
        let task = tokio::spawn(async move {
            service
                .execute(
                    &test_agent_session(AgentSessionId::TEST_A),
                    id,
                    request("NameSearch"),
                    CancellationToken::new(),
                )
                .await
        });
        started.notified().await;
        *turns.0.lock().unwrap() = next;
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(result.status, ExecutionStatus::Cancelled);
        assert_eq!(
            store.get(AgentSessionId::TEST_A, id).await.unwrap().status,
            ExecutionStatus::Cancelled
        );
    }
}

enum TurnLookup {
    Active,
    Stopped,
    Unavailable,
    Slow,
}

struct FlakyTurns(Mutex<std::collections::VecDeque<TurnLookup>>);

#[async_trait]
impl ExecutionTurns for FlakyTurns {
    async fn active(&self, _: AgentSessionId) -> Result<Option<macro_uuid::Uuid>, CodeModeError> {
        let next = self.0.lock().unwrap().pop_front().unwrap();
        match next {
            TurnLookup::Active => Ok(Some(macro_uuid::Uuid::from_u128(1))),
            TurnLookup::Stopped => Ok(None),
            TurnLookup::Unavailable => Err(CodeModeError::Unavailable),
            TurnLookup::Slow => {
                std::future::pending::<()>().await;
                unreachable!()
            }
        }
    }
}

#[tokio::test]
async fn turn_checks_retry_transient_failures_but_require_confirmed_active_state() {
    use TurnLookup::*;
    for (lookups, expected) in [
        (vec![Unavailable, Slow, Active], true),
        (vec![Stopped], false),
        (vec![Unavailable, Stopped], false),
        (vec![Unavailable, Unavailable, Unavailable], false),
    ] {
        let turns = Arc::new(FlakyTurns(Mutex::new(lookups.into())));
        let service = CodeModeService::new(
            Some(Arc::new(TestExecutor)),
            Arc::new(TestTools::default()),
            Arc::new(MemoryStore::default()),
            turns.clone(),
        );
        let session = test_agent_session(AgentSessionId::TEST_A);
        let identity = ExecutionIdentity {
            session: session.id,
            owner: session.owner_user().unwrap().clone(),
            bot: session.bot_id,
            turn: macro_uuid::Uuid::from_u128(1),
        };
        assert_eq!(active_turn(&service.0, &identity).await, expected);
        assert!(turns.0.lock().unwrap().is_empty());
    }
}
