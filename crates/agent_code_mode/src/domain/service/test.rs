use super::*;
use agent_session::testing::test_agent_session;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct MemoryStore(
    Mutex<HashMap<(AgentSessionId, String), ExecutionRecord>>,
    Mutex<Vec<AgentSessionId>>,
);

#[async_trait]
impl ExecutionStore for MemoryStore {
    async fn create(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        let mut records = self.0.lock().unwrap();
        let key = (session, record.execution_id.to_string());
        // Match the production table's globally unique execution ID.
        if records.keys().any(|(_, id)| id == &key.1) {
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
        self.1.lock().unwrap().push(session);
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
struct Credentials(Mutex<Vec<(String, bot_id::BotId)>>);
#[async_trait]
impl ExecutionCredentials for Credentials {
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        _: &str,
        _: ProgramLanguage,
        _: CancellationToken,
    ) -> Result<IssuedRun, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .push((identity.owner.to_string(), identity.agent_id));
        Ok(IssuedRun {
            environment: code_execution::domain::RunEnvironment {
                token: "run-only-secret".into(),
                ..Default::default()
            },
            acting_user: identity.owner.clone(),
        })
    }
}
/// PNG pixels named after their file, owned by the session owner; the file
/// `missing` cannot be read.
struct Pixels;
#[async_trait]
impl ModelImages for Pixels {
    async fn load_png(
        &self,
        file: &StaticFileId,
        owner: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<ModelImage> {
        anyhow::ensure!(file.as_ref() != "missing", "no such file");
        // test_agent_session's owner.
        anyhow::ensure!(
            owner.as_ref() == "macro|owner@example.com",
            "the file belongs to someone else"
        );
        Ok(ModelImage {
            r#type: ModelMediaType::Image,
            media_type: ModelImageMediaType::Png,
            data: format!("iVBORw0KGgo{}", file.as_ref()),
        })
    }
}

struct Executor;
#[async_trait]
impl ProgramExecutor for Executor {
    /// Rejects a program that says `TYPE_ERROR`, as the checker would one
    /// with a type error.
    async fn check_program(
        &self,
        request: &ExecuteRequest,
        shape: code_execution::domain::ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        assert!(shape.session && shape.execution);
        if request.source.contains("TYPE_ERROR") {
            return Err(code_execution::domain::ExecutionFailure::new(
                code_execution::domain::FailureCode::Compile,
                "The program wasn't run: it doesn't type-check against the Macro SDK.",
            )
            .into());
        }
        Ok(())
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        environment: code_execution::domain::RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        assert_eq!(environment.token, "run-only-secret");
        Outcome::Succeeded {
            value: json!({"data": 42, "reviews": []}),
        }
    }
}
fn service() -> (
    CodeModeService,
    Arc<Credentials>,
    Arc<MemoryStore>,
    Arc<TestTurns>,
) {
    let credentials = Arc::new(Credentials::default());
    let store = Arc::new(MemoryStore::default());
    let turns = Arc::new(TestTurns::default());
    (
        CodeModeService::new(
            Some(Arc::new(Executor)),
            credentials.clone(),
            store.clone(),
            turns.clone(),
            Arc::new(Pixels),
        ),
        credentials,
        store,
        turns,
    )
}
fn request() -> ExecuteRequest {
    ExecuteRequest {
        source: "export async function main() { return {data: 42, reviews: []}; }".into(),
        timeout_ms: 1000,
        language: code_execution::domain::Language::Javascript,
        module: None,
    }
}
/// A program with type errors fails before the owner is asked to approve it
/// or a credential is minted for it.
#[tokio::test]
async fn a_program_with_type_errors_stops_before_credentials() {
    let (service, credentials, store, _) = service();
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let id = ExecutionId::mint();
    let result = service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            ExecuteRequest {
                source: "export async function main() { return TYPE_ERROR; }".into(),
                timeout_ms: 1000,
                language: code_execution::domain::Language::Javascript,
                module: None,
            },
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.status, ExecutionStatus::Failed);
    assert!(credentials.0.lock().unwrap().is_empty());
    let record = store.get(session.id, id).await.unwrap();
    assert_eq!(record.status, ExecutionStatus::Failed);
    assert!(
        record
            .error
            .unwrap()
            .contains("doesn't type-check against the Macro SDK")
    );
}

#[tokio::test]
async fn run_uses_session_owner_and_records_source_and_result_without_credential() {
    let (service, credentials, store, _) = service();
    let mut session =
        test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    session.bot_id = bot_id::BotId::new_from_uuid(uuid::Uuid::from_u128(0xcafe));
    let id = ExecutionId::mint();
    let result = service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.status, ExecutionStatus::Succeeded);
    assert_eq!(
        *credentials.0.lock().unwrap(),
        [(session.owner_user().unwrap().to_string(), session.bot_id)]
    );
    let record = store.get(session.id, id).await.unwrap();
    assert_eq!(record.source, request().source);
    assert_eq!(record.result, Some(json!({"data": 42, "reviews": []})));
    assert!(
        !serde_json::to_string(&record)
            .unwrap()
            .contains("run-only-secret")
    );
    service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(credentials.0.lock().unwrap().len(), 1);
    let mut changed = request();
    changed.source.push(' ');
    let reused = service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            changed.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_ne!(reused.execution_id, id);
    assert_eq!(reused.status, ExecutionStatus::Succeeded);
    assert_eq!(credentials.0.lock().unwrap().len(), 2);
    assert_eq!(
        store
            .get(session.id, reused.execution_id)
            .await
            .unwrap()
            .source,
        changed.source
    );
    assert_eq!(
        store.get(session.id, id).await.unwrap().source,
        request().source
    );
}
#[tokio::test]
async fn archived_or_inactive_sessions_never_receive_credentials() {
    let (service, credentials, _, turns) = service();
    let mut session =
        test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    session.archived = Some(agent_session::domain::model::SessionArchive {
        by: agent_session::domain::model::ArchiveCause::User,
        at: chrono::Utc::now(),
    });
    assert!(
        service
            .execute(
                &session,
                ExecutionId::mint(),
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(1),
                request(),
                CancellationToken::new()
            )
            .await
            .is_err()
    );
    session.archived = None;
    *turns.0.lock().unwrap() = None;
    assert!(
        service
            .execute(
                &session,
                ExecutionId::mint(),
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(1),
                request(),
                CancellationToken::new()
            )
            .await
            .is_err()
    );
    assert!(credentials.0.lock().unwrap().is_empty());
}
#[tokio::test]
async fn collision_runs_under_a_fresh_id_without_reading_another_session() {
    let (service, credentials, store, _) = service();
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let id = ExecutionId::mint();
    service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    let mut other = session.clone();
    other.id = AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7());
    let receipt = service
        .execute(
            &other,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_ne!(receipt.execution_id, id);
    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(*store.1.lock().unwrap(), [other.id]);
    assert_eq!(credentials.0.lock().unwrap().len(), 2);
    assert!(store.get(other.id, receipt.execution_id).await.is_ok());
    assert!(store.get(session.id, id).await.is_ok());
}

#[tokio::test]
async fn unfinished_journal_reads_and_retries_report_uncertainty_without_replaying() {
    let (service, credentials, store, _) = service();
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let id = ExecutionId::mint();
    let mut record = ExecutionRecord {
        acting_as: Some(ai_toolset::actor::ToolActor::Owner),
        turn_id: Some(macro_uuid::Uuid::from_u128(1)),
        execution_id: id,
        source: request().source,
        language: Default::default(),
        sdk_fingerprint: None,
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
        permission: None,
    };
    store.create(session.id, &record).await.unwrap();
    let access = EntityAccessReceipt::dangerously_assert_authenticated_user(
        session.owner_user().unwrap().clone(),
        &session.id.to_string(),
        EntityType::AgentSession,
    );
    let read = service.read(&access, id).await.unwrap();
    let retry = service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(read.error.as_ref().unwrap().contains("unconfirmed"));
    assert_eq!(retry.error, read.error);
    assert!(credentials.0.lock().unwrap().is_empty());
    assert!(read.result.is_none());
    assert!(store.get(session.id, id).await.unwrap().error.is_none());

    record.status = ExecutionStatus::Succeeded;
    record.result = Some(json!({"data": 42, "reviews": []}));
    store.save(session.id, &record).await.unwrap();
    let finished = service.read(&access, id).await.unwrap();
    assert_eq!(finished.status, ExecutionStatus::Succeeded);
    assert_eq!(finished.result, record.result);
    assert!(finished.error.is_none());
}

struct ValueExecutor(serde_json::Value);
#[async_trait]
impl ProgramExecutor for ValueExecutor {
    async fn check_program(
        &self,
        _: &ExecuteRequest,
        _: code_execution::domain::ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        Ok(())
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        Outcome::Succeeded {
            value: self.0.clone(),
        }
    }
}

#[tokio::test]
async fn optional_reviews_default_to_empty_without_accepting_malformed_results() {
    for (value, succeeds) in [
        (json!({"data": {"documents": []}}), true),
        (json!({"data": null}), true),
        (json!({"data": 42, "reviews": []}), true),
        (
            json!({"data": 42, "reviews": [{"kind": "email", "id": "4fc46951-6c4c-49ba-a228-f00bbfc12d37"}]}),
            true,
        ),
        (json!({"data": 42, "reviews": null}), false),
        (json!({"data": 42, "reviews": [{}]}), false),
        (json!({"reviews": []}), false),
        (json!({"data": 42, "extra": true}), false),
        (
            json!({"data": 42, "images": [{"id": "render-1", "url": "https://x"}]}),
            true,
        ),
        (json!({"data": 42, "images": []}), true),
        (
            json!({"data": 42, "images": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}),
            false,
        ),
        (json!({"data": 42, "images": [{"id": "../file"}]}), false),
        (json!({"data": 42, "images": [{"url": "https://x"}]}), false),
        (json!({"data": 42, "images": {"id": "a"}}), false),
    ] {
        let store = Arc::new(MemoryStore::default());
        let service = CodeModeService::new(
            Some(Arc::new(ValueExecutor(value.clone()))),
            Arc::new(Credentials::default()),
            store.clone(),
            Arc::new(TestTurns::default()),
            Arc::new(Pixels),
        );
        let session =
            test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
        let id = ExecutionId::mint();
        let result = service
            .execute(
                &session,
                id,
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(1),
                request(),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(
            result.status == ExecutionStatus::Succeeded,
            succeeds,
            "{value}"
        );
        let saved = store.get(session.id, id).await.unwrap();
        let mut expected = value.clone();
        if succeeds && expected.get("reviews").is_none() {
            expected["reviews"] = json!([]);
        }
        assert_eq!(saved.result, Some(expected));
    }
}

struct ActivityExecutor;
#[async_trait]
impl ProgramExecutor for ActivityExecutor {
    async fn check_program(
        &self,
        _: &ExecuteRequest,
        _: code_execution::domain::ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        Ok(())
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        unreachable!("the service should observe progress")
    }
    async fn execute_program_with_progress(
        &self,
        _: ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        _: CancellationToken,
        progress: tokio::sync::mpsc::Sender<serde_json::Value>,
    ) -> Outcome {
        progress
            .send(json!({"id":1,"service":"cognition","operation":"decisions","status":"started"}))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        progress
            .send(
                json!({"id":1,"service":"cognition","operation":"decisions","status":"completed"}),
            )
            .await
            .unwrap();
        progress
            .send(json!({"id":2,"service":"cognition","operation":"decisions","status":"started"}))
            .await
            .unwrap();
        Outcome::Succeeded {
            value: json!({"data":42}),
        }
    }
}

#[tokio::test]
async fn persists_live_activity_and_marks_unfinished_requests_unknown() {
    let store = Arc::new(MemoryStore::default());
    let service = CodeModeService::new(
        Some(Arc::new(ActivityExecutor)),
        Arc::new(Credentials::default()),
        store.clone(),
        Arc::new(TestTurns::default()),
        Arc::new(Pixels),
    );
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let id = ExecutionId::mint();
    let session_id = session.id;
    let running = tokio::spawn(async move {
        service
            .execute(
                &session,
                id,
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(1),
                request(),
                CancellationToken::new(),
            )
            .await
            .unwrap()
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Ok(record) = store.get(session_id, id).await {
                if !record.activity.is_empty() {
                    assert_eq!(record.status, ExecutionStatus::Running);
                    assert_eq!(record.activity[0].status, RecordedCallStatus::Running);
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let receipt = running.await.unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    assert_eq!(receipt.activity.len(), 2);
    assert_eq!(receipt.activity[0].status, RecordedCallStatus::Completed);
    assert_eq!(receipt.activity[1].status, RecordedCallStatus::Unknown);
    let record = store.get(session_id, id).await.unwrap();
    assert_eq!(record.activity.len(), 2);
    assert_eq!(record.activity[0].status, RecordedCallStatus::Completed);
    assert_eq!(record.activity[1].status, RecordedCallStatus::Unknown);
    assert_eq!(record.result, Some(json!({"data":42,"reviews":[]})));
}

#[test]
fn activity_rejects_unknown_operations_and_is_bounded() {
    let mut record = ExecutionRecord {
        acting_as: Some(ai_toolset::actor::ToolActor::Owner),
        turn_id: Some(macro_uuid::Uuid::from_u128(1)),
        execution_id: ExecutionId::mint(),
        source: String::new(),
        language: Default::default(),
        sdk_fingerprint: None,
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: vec![],
        activity: vec![],
        activity_truncated: false,
        permission: None,
    };
    super::super::activity::observe(
        &mut record.activity,
        &mut record.activity_truncated,
        json!({"id":1,"service":"secret","operation":"user supplied text","status":"started"}),
    );
    assert!(record.activity.is_empty());
    for id in 0..130 {
        super::super::activity::observe(
            &mut record.activity,
            &mut record.activity_truncated,
            json!({"id":id,"service":"cognition","operation":"decisions","status":"started"}),
        );
    }
    assert_eq!(record.activity.len(), 128);
    assert!(record.activity_truncated);
}

struct SlowActivityStore {
    inner: MemoryStore,
    saving: tokio::sync::Notify,
}
#[async_trait]
impl ExecutionStore for SlowActivityStore {
    async fn create(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        self.inner.create(session, record).await
    }
    async fn save(
        &self,
        session: AgentSessionId,
        record: &ExecutionRecord,
    ) -> Result<(), CodeModeError> {
        if record.status == ExecutionStatus::Running {
            self.saving.notify_one();
            std::future::pending::<()>().await;
        }
        self.inner.save(session, record).await
    }
    async fn get(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        self.inner.get(session, execution).await
    }
}
struct CancelActivityExecutor;
#[async_trait]
impl ProgramExecutor for CancelActivityExecutor {
    async fn check_program(
        &self,
        _: &ExecuteRequest,
        _: code_execution::domain::ContextShape,
        _: CancellationToken,
    ) -> Result<(), Outcome> {
        Ok(())
    }
    async fn execute_program(
        &self,
        _: ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        _: CancellationToken,
    ) -> Outcome {
        unreachable!()
    }
    async fn execute_program_with_progress(
        &self,
        _: ExecuteRequest,
        _: code_execution::domain::RunEnvironment,
        cancel: CancellationToken,
        progress: tokio::sync::mpsc::Sender<serde_json::Value>,
    ) -> Outcome {
        progress
            .send(json!({"id":1,"service":"cognition","operation":"decisions","status":"started"}))
            .await
            .unwrap();
        cancel.cancelled().await;
        Outcome::Cancelled
    }
}
#[tokio::test]
async fn cancellation_is_not_blocked_by_a_stalled_activity_save() {
    let store = Arc::new(SlowActivityStore {
        inner: MemoryStore::default(),
        saving: tokio::sync::Notify::new(),
    });
    let service = CodeModeService::new(
        Some(Arc::new(CancelActivityExecutor)),
        Arc::new(Credentials::default()),
        store.clone(),
        Arc::new(TestTurns::default()),
        Arc::new(Pixels),
    );
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let run = tokio::spawn(async move {
        service
            .execute(
                &session,
                ExecutionId::mint(),
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(1),
                request(),
                token,
            )
            .await
            .unwrap()
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), store.saving.notified())
        .await
        .unwrap();
    cancel.cancel();
    let receipt = tokio::time::timeout(std::time::Duration::from_millis(300), run)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Cancelled);
}

#[tokio::test]
async fn execution_retries_cannot_change_accounts_or_move_between_turns() {
    let (service, credentials, store, turns) = service();
    let session = test_agent_session(AgentSessionId::new());
    let id = ExecutionId::mint();
    service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    // A retry under another account or turn never adopts the saved result; it
    // runs as a new execution with its own ID and credential.
    let requester = service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Requester,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_ne!(requester.execution_id, id);
    *turns.0.lock().unwrap() = Some(macro_uuid::Uuid::from_u128(2));
    let next_turn = service
        .execute(
            &session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(2),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_ne!(next_turn.execution_id, id);
    assert_ne!(next_turn.execution_id, requester.execution_id);
    assert_eq!(credentials.0.lock().unwrap().len(), 3);
    let original = store.get(session.id, id).await.unwrap();
    assert_eq!(
        original.acting_as,
        Some(ai_toolset::actor::ToolActor::Owner)
    );
    assert_eq!(original.turn_id, Some(macro_uuid::Uuid::from_u128(1)));
}

#[tokio::test]
async fn a_delayed_call_cannot_adopt_a_new_turn_or_receive_credentials() {
    let (service, credentials, store, turns) = service();
    let session = test_agent_session(AgentSessionId::new());
    *turns.0.lock().unwrap() = Some(macro_uuid::Uuid::from_u128(2));
    let result = service
        .execute(
            &session,
            ExecutionId::mint(),
            ai_toolset::actor::ToolActor::Requester,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await;
    assert!(matches!(result, Err(CodeModeError::Forbidden)));
    assert!(credentials.0.lock().unwrap().is_empty());
    assert!(store.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn returned_images_reach_the_model_as_pixels() {
    let service = CodeModeService::new(
        Some(Arc::new(ValueExecutor(json!({
            "data": {"link": "https://macro.com/app/canvas/1"},
            "images": [{"id": "render-1", "url": "https://static/file/render-1", "width": 10}],
        })))),
        Arc::new(Credentials::default()),
        Arc::new(MemoryStore::default()),
        Arc::new(TestTurns::default()),
        Arc::new(Pixels),
    );
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let receipt = service
        .execute(
            &session,
            ExecutionId::mint(),
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    let json = serde_json::to_value(&receipt).unwrap();
    assert_eq!(json["status"], "succeeded");
    assert_eq!(json["error"], serde_json::Value::Null);
    assert_eq!(
        json["modelMedia"],
        json!([{"type": "image", "mediaType": "image/png", "data": "iVBORw0KGgorender-1"}])
    );
    assert_eq!(json["result"]["images"][0]["id"], "render-1");
}

#[tokio::test]
async fn an_unreadable_returned_image_is_reported_without_pixels() {
    let service = CodeModeService::new(
        Some(Arc::new(ValueExecutor(json!({
            "data": 1,
            "images": [{"id": "render-1"}, {"id": "missing"}],
        })))),
        Arc::new(Credentials::default()),
        Arc::new(MemoryStore::default()),
        Arc::new(TestTurns::default()),
        Arc::new(Pixels),
    );
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let receipt = service
        .execute(
            &session,
            ExecutionId::mint(),
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    let json = serde_json::to_value(&receipt).unwrap();
    assert_eq!(json["status"], "succeeded");
    assert!(json.get("modelMedia").is_none());
    assert_eq!(
        json["error"],
        "main succeeded, but image missing could not be shown: return a PNG from the SDK, such as await canvas.render()."
    );
}

struct Rollout(bool);
#[async_trait]
impl OwnerRollout for Rollout {
    async fn enabled(&self, _: &macro_user_id::user_id::MacroUserIdStr<'static>) -> bool {
        self.0
    }
}

fn with_js_tools(service: CodeModeService, on: bool) -> CodeModeService {
    service.with_js_tools(JsToolsPrograms {
        fingerprint: "@opencode/codemode@0+fixture".into(),
        rollout: Arc::new(Rollout(on)),
    })
}

fn js_tools_request() -> ExecuteRequest {
    ExecuteRequest {
        source:
            "return await tools.storage.get_document_markdown({ path: { document_id: \"d\" } })"
                .into(),
        timeout_ms: 1000,
        language: code_execution::domain::Language::JsTools,
        module: None,
    }
}

async fn run(
    service: &CodeModeService,
    session: &AgentSession,
    id: ExecutionId,
    request: ExecuteRequest,
) -> Result<ExecutionReceipt, CodeModeError> {
    service
        .execute(
            session,
            id,
            ai_toolset::actor::ToolActor::Owner,
            macro_uuid::Uuid::from_u128(1),
            request,
            CancellationToken::new(),
        )
        .await
}

/// The kind a turn of `session` runs, as every surface reads it.
async fn kind(service: &CodeModeService, session: &AgentSession) -> CodeModeKind {
    service
        .code_mode_kind(session.id, session.owner_user().unwrap())
        .await
}

#[tokio::test]
async fn js_tools_programs_are_refused_before_credentials_without_the_rollout() {
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let (unwired, credentials, _, _) = service();
    assert_eq!(kind(&unwired, &session).await, CodeModeKind::TypeScript);
    let refused = run(&unwired, &session, ExecutionId::mint(), js_tools_request()).await;
    assert!(
        matches!(refused, Err(CodeModeError::Invalid(message)) if message.starts_with("This session runs TypeScript programs"))
    );
    let off = with_js_tools(unwired, false);
    assert_eq!(kind(&off, &session).await, CodeModeKind::TypeScript);
    assert!(matches!(
        run(&off, &session, ExecutionId::mint(), js_tools_request()).await,
        Err(CodeModeError::Invalid(_))
    ));
    assert!(credentials.0.lock().unwrap().is_empty());
    // JavaScript is unaffected by the rollout.
    let receipt = run(&off, &session, ExecutionId::mint(), request())
        .await
        .unwrap();
    assert_eq!(receipt.status, ExecutionStatus::Succeeded);

    let (service, _, _, _) = service();
    let no_runner = CodeModeService::new(
        None,
        Arc::clone(&service.0.credentials),
        Arc::clone(&service.0.store),
        Arc::clone(&service.0.turns),
        Arc::new(Pixels),
    );
    assert_eq!(
        kind(&with_js_tools(no_runner, true), &session).await,
        CodeModeKind::TypeScript
    );
}

#[tokio::test]
async fn js_tools_runs_record_language_and_fingerprint_and_retries_match_language() {
    let (typescript, credentials, store, _) = service();
    let dialect = with_js_tools(typescript, true);
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    assert_eq!(kind(&dialect, &session).await, CodeModeKind::Dialect);
    let id = ExecutionId::mint();
    let receipt = run(&dialect, &session, id, js_tools_request())
        .await
        .unwrap();
    assert_eq!(receipt.execution_id, id);
    let record = store.get(session.id, id).await.unwrap();
    assert_eq!(record.language, ProgramLanguage::JsTools);
    assert_eq!(
        record.sdk_fingerprint.as_deref(),
        Some("@opencode/codemode@0+fixture")
    );
    let stored = serde_json::to_value(&record).unwrap();
    assert_eq!(stored["language"], "js_tools");
    assert_eq!(stored["sdkFingerprint"], "@opencode/codemode@0+fixture");

    // The same ID and source is the saved run.
    let retry = run(&dialect, &session, id, js_tools_request())
        .await
        .unwrap();
    assert_eq!(retry.execution_id, id);
    assert_eq!(credentials.0.lock().unwrap().len(), 1);
    // A dialect turn refuses TypeScript before anything is recorded or minted.
    let mut javascript = js_tools_request();
    javascript.language = code_execution::domain::Language::Javascript;
    assert!(matches!(
        run(&dialect, &session, id, javascript).await,
        Err(CodeModeError::Invalid(message)) if message.starts_with("This session runs JS tools programs")
    ));
    assert_eq!(credentials.0.lock().unwrap().len(), 1);

    // A JavaScript record serializes as before languages: no language, no
    // fingerprint.
    let (typescript, _, store, _) = service();
    let id = ExecutionId::mint();
    run(&typescript, &session, id, request()).await.unwrap();
    let record = store.get(session.id, id).await.unwrap();
    assert_eq!(record.language, ProgramLanguage::Javascript);
    assert_eq!(record.sdk_fingerprint, None);
    let stored = serde_json::to_value(&record).unwrap();
    assert!(stored.get("sdkFingerprint").is_none());
    assert!(stored.get("language").is_none(), "{stored}");
    let read: ExecutionRecord = serde_json::from_value(stored).unwrap();
    assert_eq!(read.language, ProgramLanguage::Javascript);
}

#[test]
fn records_saved_before_languages_read_as_javascript() {
    let record: ExecutionRecord = serde_json::from_value(json!({
        "executionId": ExecutionId::mint(),
        "source": "export async function main() {}",
        "status": "succeeded",
        "result": null,
        "error": null,
        "calls": [],
    }))
    .unwrap();
    assert_eq!(record.language, ProgramLanguage::Javascript);
    assert_eq!(record.sdk_fingerprint, None);
}

/// Credentials that check the program and refuse to run it.
struct NotRunCredentials(Option<ExecutionPermission>);
#[async_trait]
impl ExecutionCredentials for NotRunCredentials {
    async fn issue(
        &self,
        _: &ExecutionIdentity,
        _: &str,
        _: ProgramLanguage,
        _: CancellationToken,
    ) -> Result<IssuedRun, CodeModeError> {
        Err(CodeModeError::NotRun(NotRun {
            message: "This program did not run.".into(),
            permission: self.0.clone(),
        }))
    }
}

fn blocked() -> ExecutionPermission {
    ExecutionPermission::Blocked {
        operations: vec![GatedOperation {
            service: "email".into(),
            operation: "send_message".into(),
            label: "Send an email".into(),
            group: "email".into(),
            group_name: "Email".into(),
            action: Some(agent_permission_registry::Action::Send),
            state: agent_permissions::domain::model::PermissionState::Never,
            origin: agent_permissions::domain::model::Origin::GroupAction,
        }],
    }
}

#[tokio::test]
async fn a_program_its_permissions_stop_is_recorded_as_failed_with_why() {
    for permission in [Some(blocked()), None] {
        let store = Arc::new(MemoryStore::default());
        let service = with_js_tools(
            CodeModeService::new(
                Some(Arc::new(Executor)),
                Arc::new(NotRunCredentials(permission.clone())),
                store.clone(),
                Arc::new(TestTurns::default()),
                Arc::new(Pixels),
            ),
            true,
        );
        let session =
            test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
        let receipt = run(&service, &session, ExecutionId::mint(), js_tools_request())
            .await
            .expect("a receipt, not an error");
        assert_eq!(receipt.status, ExecutionStatus::Failed);
        assert_eq!(receipt.error.as_deref(), Some("This program did not run."));
        assert_eq!(receipt.permission, permission);
        assert_eq!(receipt.result, None);
        let record = store.get(session.id, receipt.execution_id).await.unwrap();
        assert_eq!(record.status, ExecutionStatus::Failed);
        assert_eq!(record.permission, permission);
        let stored = serde_json::to_value(&record).unwrap();
        let read: ExecutionRecord = serde_json::from_value(stored.clone()).unwrap();
        assert_eq!(read.permission, permission);
        if permission.is_some() {
            assert_eq!(stored["permission"]["outcome"], "blocked");
            assert_eq!(
                serde_json::to_value(&receipt).unwrap()["permission"]["outcome"],
                "blocked"
            );
        }
    }
}

#[test]
fn records_and_receipts_without_a_permission_serialize_as_before() {
    let id = ExecutionId::from_uuid(macro_uuid::Uuid::from_u128(7));
    let record = ExecutionRecord {
        execution_id: id,
        acting_as: None,
        turn_id: None,
        source: "export async function main() {}".into(),
        language: ProgramLanguage::Javascript,
        sdk_fingerprint: None,
        status: ExecutionStatus::Succeeded,
        result: Some(json!({"data": 1})),
        error: None,
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
        permission: None,
    };
    assert_eq!(
        serde_json::to_value(&record).unwrap(),
        json!({
            "executionId": "00000000-0000-0000-0000-000000000007",
            "actingAs": null,
            "turnId": null,
            "source": "export async function main() {}",
            "status": "succeeded",
            "result": {"data": 1},
            "error": null,
            "calls": [],
            "activity": [],
            "activityTruncated": false,
        })
    );
    assert_eq!(
        serde_json::to_value(receipt(&record)).unwrap(),
        json!({
            "executionId": "00000000-0000-0000-0000-000000000007",
            "status": "succeeded",
            "activity": [],
            "result": {"data": 1},
            "error": null,
        })
    );
}

#[test]
fn a_request_the_gate_refused_is_recorded_as_refused() {
    let mut activity = Vec::new();
    let mut truncated = false;
    super::super::activity::observe(
        &mut activity,
        &mut truncated,
        json!({"id": 1, "service": "contacts", "operation": "getContacts", "status": "refused"}),
    );
    assert_eq!(activity.len(), 1);
    assert_eq!(activity[0].status, RecordedCallStatus::Refused);
    super::super::activity::finish(&mut activity);
    assert_eq!(activity[0].status, RecordedCallStatus::Refused);
    assert_eq!(
        serde_json::to_value(&activity[0]).unwrap()["status"],
        "refused"
    );
}
