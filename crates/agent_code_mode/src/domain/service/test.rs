use super::*;
use agent_session::testing::test_agent_session;
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
        _: CancellationToken,
    ) -> Result<code_execution::domain::RunEnvironment, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .push((identity.owner.to_string(), identity.agent_id));
        Ok(code_execution::domain::RunEnvironment {
            token: "run-only-secret".into(),
            ..Default::default()
        })
    }
}
struct Executor;
#[async_trait]
impl ProgramExecutor for Executor {
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
            Arc::new(Views),
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
    }
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
    assert!(matches!(
        service
            .execute(
                &session,
                id,
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(1),
                changed,
                CancellationToken::new()
            )
            .await,
        Err(CodeModeError::Duplicate)
    ));
}
#[tokio::test]
async fn archived_or_inactive_sessions_never_receive_credentials() {
    let (service, credentials, _, turns) = service();
    let mut session =
        test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    session.is_archived = true;
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
    session.is_archived = false;
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
async fn collision_does_not_lookup_another_session_or_issue_a_credential() {
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
    assert!(matches!(
        service
            .execute(
                &other,
                id,
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(1),
                request(),
                CancellationToken::new()
            )
            .await,
        Err(CodeModeError::Invalid(_))
    ));
    assert_eq!(*store.1.lock().unwrap(), [other.id]);
    assert_eq!(credentials.0.lock().unwrap().len(), 1);
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
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
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

/// Draws a view with a list of widgets, as the renderer's schema requires.
struct Views;
impl ViewCheck for Views {
    fn problems(&self, view: &serde_json::Value) -> Vec<String> {
        if view.get("widgets").is_some_and(serde_json::Value::is_array) {
            Vec::new()
        } else {
            vec!["view.widgets should be array, not missing".into()]
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
        (json!({"data": 42, "view": {"widgets": []}}), true),
        (json!({"data": 42, "view": null}), true),
    ] {
        let store = Arc::new(MemoryStore::default());
        let service = CodeModeService::new(
            Some(Arc::new(ValueExecutor(value.clone()))),
            Arc::new(Credentials::default()),
            store.clone(),
            Arc::new(TestTurns::default()),
            Arc::new(Views),
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

#[tokio::test]
async fn a_view_the_renderer_would_not_draw_fails_the_run_and_says_why() {
    let value = json!({"data": 42, "view": {"title": "Results"}});
    let store = Arc::new(MemoryStore::default());
    let service = CodeModeService::new(
        Some(Arc::new(ValueExecutor(value.clone()))),
        Arc::new(Credentials::default()),
        store.clone(),
        Arc::new(TestTurns::default()),
        Arc::new(Views),
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
    assert_eq!(receipt.status, ExecutionStatus::Failed);
    let error = receipt.error.unwrap();
    assert!(error.contains("view.widgets should be array"), "{error}");
    // The program's writes already happened: the fix is Show, not
    // another run.
    assert!(error.contains("do not run it again"), "{error}");
    assert_eq!(receipt.result.unwrap()["view"], value["view"]);
}

struct ActivityExecutor;
#[async_trait]
impl ProgramExecutor for ActivityExecutor {
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
        Arc::new(Views),
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
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: vec![],
        activity: vec![],
        activity_truncated: false,
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
        Arc::new(Views),
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

fn running_record() -> ExecutionRecord {
    ExecutionRecord {
        execution_id: ExecutionId::mint(),
        acting_as: None,
        turn_id: None,
        source: String::new(),
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: vec![],
        activity: vec![],
        activity_truncated: false,
    }
}

fn markdown(id: u64, status: &str, item: serde_json::Value) -> serde_json::Value {
    json!({"id": id, "service": "storage", "operation": "createMarkdownHandler", "status": status, "item": item})
}

const DOCUMENT: &str = "0199f3a2-1b2c-7d4e-8f90-a1b2c3d4e5f6";

/// One activity event into a run's record, as `execute` hands it on.
fn observe(record: &mut ExecutionRecord, value: serde_json::Value) {
    super::super::activity::observe(&mut record.activity, &mut record.activity_truncated, value);
}

fn created_document(title: &str) -> serde_json::Value {
    json!({"type": "document", "id": DOCUMENT, "action": "created", "title": title})
}

#[test]
fn an_operation_keeps_the_item_it_reported_on_completing() {
    let mut record = running_record();
    observe(&mut record, markdown(1, "started", created_document("x")));
    assert_eq!(record.activity[0].item, None);
    observe(
        &mut record,
        markdown(1, "completed", created_document("  Q3\n plan ")),
    );
    assert_eq!(
        record.activity[0].item,
        Some(ActivityItem {
            item_type: ActivityItemType::Document,
            id: DOCUMENT.into(),
            action: ActivityItemAction::Created,
            title: Some("Q3 plan".into()),
        })
    );
    // A failed write changed nothing.
    observe(&mut record, markdown(2, "started", json!(null)));
    observe(&mut record, markdown(2, "failed", created_document("x")));
    assert_eq!(record.activity[1].item, None);
    assert_eq!(
        serde_json::to_value(&record.activity[0]).unwrap(),
        json!({"id": 1, "label": "Create Markdown", "status": "completed", "item": {
            "type": "document", "id": DOCUMENT, "action": "created", "title": "Q3 plan",
        }})
    );
    assert_eq!(
        serde_json::to_value(&record.activity[1]).unwrap(),
        json!({"id": 2, "label": "Create Markdown", "status": "failed"})
    );
}

#[test]
fn an_unreadable_item_still_lets_its_operation_finish() {
    let cases = [
        json!({"type": "task", "id": DOCUMENT, "action": "created"}),
        json!({"type": "document", "id": "../../etc", "action": "created"}),
        json!({"type": "document", "id": "", "action": "created"}),
        json!({"type": "document", "id": "a".repeat(129), "action": "created"}),
        json!({"type": "document", "id": DOCUMENT, "action": "created", "html": "<b>"}),
    ];
    for item in cases {
        let mut record = running_record();
        observe(&mut record, markdown(1, "started", json!(null)));
        observe(&mut record, markdown(1, "completed", item.clone()));
        assert_eq!(
            record.activity[0].status,
            RecordedCallStatus::Completed,
            "{item}"
        );
        assert_eq!(record.activity[0].item, None, "{item}");
    }
    let mut record = running_record();
    observe(&mut record, markdown(1, "started", json!(null)));
    observe(
        &mut record,
        markdown(1, "completed", created_document(&"x".repeat(300))),
    );
    assert_eq!(
        record.activity[0]
            .item
            .as_ref()
            .unwrap()
            .title
            .as_ref()
            .unwrap()
            .len(),
        100
    );
}

#[test]
fn a_run_keeps_at_most_thirty_two_items() {
    let mut record = running_record();
    for id in 0..40 {
        observe(&mut record, markdown(id, "started", json!(null)));
        observe(
            &mut record,
            markdown(id, "completed", created_document("x")),
        );
    }
    assert_eq!(record.activity.len(), 40);
    assert_eq!(
        record
            .activity
            .iter()
            .filter(|activity| activity.item.is_some())
            .count(),
        32
    );
}

struct ItemExecutor;
#[async_trait]
impl ProgramExecutor for ItemExecutor {
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
            .send(markdown(1, "started", json!(null)))
            .await
            .unwrap();
        progress
            .send(markdown(1, "completed", created_document("Q3 plan")))
            .await
            .unwrap();
        Outcome::Succeeded {
            value: json!({"data": 42}),
        }
    }
}

#[tokio::test]
async fn a_runs_receipt_carries_the_items_it_changed() {
    let store = Arc::new(MemoryStore::default());
    let service = CodeModeService::new(
        Some(Arc::new(ItemExecutor)),
        Arc::new(Credentials::default()),
        store.clone(),
        Arc::new(TestTurns::default()),
        Arc::new(Views),
    );
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7()));
    let id = ExecutionId::mint();
    let receipt = service
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
    assert_eq!(receipt.status, ExecutionStatus::Succeeded);
    let item = receipt.activity[0].item.as_ref().unwrap();
    assert_eq!(
        (item.id.as_str(), item.action),
        (DOCUMENT, ActivityItemAction::Created)
    );
    let record = store.get(session.id, id).await.unwrap();
    assert_eq!(record.activity[0].item.as_ref(), Some(item));
}

#[tokio::test]
async fn execution_retries_cannot_change_accounts_or_move_between_turns() {
    let (service, credentials, _, turns) = service();
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
    assert!(matches!(
        service
            .execute(
                &session,
                id,
                ai_toolset::actor::ToolActor::Requester,
                macro_uuid::Uuid::from_u128(1),
                request(),
                CancellationToken::new()
            )
            .await,
        Err(CodeModeError::Duplicate)
    ));
    *turns.0.lock().unwrap() = Some(macro_uuid::Uuid::from_u128(2));
    assert!(matches!(
        service
            .execute(
                &session,
                id,
                ai_toolset::actor::ToolActor::Owner,
                macro_uuid::Uuid::from_u128(2),
                request(),
                CancellationToken::new()
            )
            .await,
        Err(CodeModeError::Duplicate)
    ));
    assert_eq!(credentials.0.lock().unwrap().len(), 1);
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
