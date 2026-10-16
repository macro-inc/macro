use super::*;
use crate::domain::{ExecutionRecord, ExecutionStatus};
use macro_user_id::cowlike::CowLike;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Default)]
struct Store(Mutex<HashMap<(AgentSessionId, Uuid), ReviewRecord>>);
#[async_trait]
impl ReviewStore for Store {
    async fn create(
        &self,
        record: &ReviewRecord,
        max_per_session: u16,
    ) -> Result<(), CodeModeError> {
        let mut rows = self.0.lock().unwrap();
        if rows
            .values()
            .filter(|row| row.session_id == record.session_id)
            .count()
            >= usize::from(max_per_session)
        {
            return Err(invalid());
        }
        rows.insert((record.session_id, record.id.0), record.clone());
        Ok(())
    }
    async fn get(
        &self,
        session: AgentSessionId,
        id: ReviewId,
    ) -> Result<ReviewRecord, CodeModeError> {
        self.0
            .lock()
            .unwrap()
            .get(&(session, id.0))
            .cloned()
            .ok_or(CodeModeError::NotFound)
    }
    async fn list(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<Vec<ReviewRecord>, CodeModeError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .values()
            .filter(|row| row.session_id == session && row.execution_id == Some(execution))
            .cloned()
            .collect())
    }
    async fn save(&self, expected: i64, record: &ReviewRecord) -> Result<(), CodeModeError> {
        let mut rows = self.0.lock().unwrap();
        let current = rows
            .get_mut(&(record.session_id, record.id.0))
            .ok_or(CodeModeError::NotFound)?;
        if current.revision != expected {
            return Err(CodeModeError::Conflict);
        }
        *current = record.clone();
        Ok(())
    }
}
struct Executions {
    session: AgentSessionId,
    execution: ExecutionId,
}
#[async_trait]
impl ExecutionStore for Executions {
    async fn create(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!()
    }
    async fn save(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!()
    }
    async fn get(
        &self,
        session: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        if session != self.session || execution != self.execution {
            return Err(CodeModeError::NotFound);
        }
        Ok(ExecutionRecord {
            execution_id: execution,
            source: String::new(),
            status: ExecutionStatus::Running,
            result: None,
            error: None,
            calls: vec![],
            activity: Vec::new(),
            activity_truncated: false,
        })
    }
}
struct Actions {
    owner: MacroUserIdStr<'static>,
    archived: AtomicBool,
    calls: Mutex<Vec<Value>>,
    notifications: Mutex<Vec<Uuid>>,
    presentations: Mutex<Vec<ReviewId>>,
    fail_presentation: AtomicBool,
    fail_notification: AtomicBool,
    block_actions: AtomicBool,
    action_gate: tokio::sync::Notify,
}
#[async_trait]
impl ReviewActions for Actions {
    async fn session(&self, _: AgentSessionId) -> Result<ReviewSession, CodeModeError> {
        Ok(ReviewSession {
            owner: self.owner.clone(),
            archived: self.archived.load(Ordering::SeqCst),
        })
    }
    fn validate(&self, _: ReviewKind, draft: &Value) -> Result<(), CodeModeError> {
        if draft.get("subject").and_then(Value::as_str).is_none() {
            return Err(invalid());
        }
        Ok(())
    }
    async fn execute(
        &self,
        owner: &MacroUserIdStr<'static>,
        _: ReviewKind,
        draft: Value,
    ) -> Result<Value, CodeModeError> {
        assert_eq!(owner, &self.owner);
        self.calls.lock().unwrap().push(draft.clone());
        if self.block_actions.load(Ordering::SeqCst) {
            self.action_gate.notified().await;
        }
        if draft.get("fail").is_some() {
            return Err(invalid());
        }
        Ok(draft)
    }
    async fn present(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError> {
        assert_eq!(owner, &self.owner);
        self.presentations.lock().unwrap().push(record.id);
        if self.fail_presentation.load(Ordering::SeqCst) {
            return Err(invalid());
        }
        Ok(())
    }
    async fn notify(
        &self,
        _: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError> {
        self.notifications
            .lock()
            .unwrap()
            .push(record.notification_id.unwrap());
        if self.fail_notification.load(Ordering::SeqCst) {
            return Err(invalid());
        }
        Ok(())
    }
}
struct Fixture {
    service: ReviewService,
    store: Arc<Store>,
    actions: Arc<Actions>,
    session: AgentSessionId,
    execution: ExecutionId,
}
impl Fixture {
    fn new() -> Self {
        let session = AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7());
        let execution = ExecutionId::mint();
        let owner = MacroUserIdStr::parse_from_str("macro|reviews@macro.local")
            .unwrap()
            .into_owned();
        let store = Arc::new(Store::default());
        let actions = Arc::new(Actions {
            owner,
            archived: AtomicBool::new(false),
            calls: Mutex::default(),
            notifications: Mutex::default(),
            presentations: Mutex::default(),
            fail_presentation: AtomicBool::new(false),
            fail_notification: AtomicBool::new(false),
            block_actions: AtomicBool::new(false),
            action_gate: tokio::sync::Notify::new(),
        });
        let service = ReviewService::new(
            store.clone(),
            Arc::new(Executions { session, execution }),
            actions.clone(),
        );
        Self {
            service,
            store,
            actions,
            session,
            execution,
        }
    }
    fn edit(&self) -> EntityAccessReceipt<EditAccessLevel> {
        EntityAccessReceipt::dangerously_assert_authenticated_user(
            self.actions.owner.clone(),
            &self.session.to_string(),
            EntityType::AgentSession,
        )
    }
    fn view(&self) -> EntityAccessReceipt<ViewAccessLevel> {
        EntityAccessReceipt::dangerously_assert_authenticated_user(
            self.actions.owner.clone(),
            &self.session.to_string(),
            EntityType::AgentSession,
        )
    }
    fn input(&self, drafts: Vec<Value>) -> CreateReview {
        CreateReview {
            execution_id: Some(self.execution),
            kind: ReviewKind::Email,
            title: "Emails".into(),
            drafts,
        }
    }
    async fn create(&self, drafts: Vec<Value>) -> ReviewRecord {
        self.service
            .create(&self.edit(), &self.actions.owner, self.input(drafts))
            .await
            .unwrap()
    }
    async fn settled(&self, id: ReviewId) -> ReviewRecord {
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let row = self.store.get(self.session, id).await.unwrap();
                if row.notification_id.is_none()
                    && row
                        .items
                        .iter()
                        .all(|item| item.status != ReviewItemStatus::Submitting)
                {
                    return row;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("review task completed")
    }
}
#[tokio::test]
async fn owner_receipt_execution_and_archive_are_enforced_before_creation() {
    let f = Fixture::new();
    let stranger = MacroUserIdStr::parse_from_str("macro|other@macro.local")
        .unwrap()
        .into_owned();
    assert!(matches!(
        f.service
            .create(&f.edit(), &stranger, f.input(vec![json!({"subject":"x"})]))
            .await,
        Err(CodeModeError::Forbidden)
    ));
    let mut input = f.input(vec![json!({"subject":"x"})]);
    input.execution_id = Some(ExecutionId::mint());
    assert!(matches!(
        f.service.create(&f.edit(), &f.actions.owner, input).await,
        Err(CodeModeError::NotFound)
    ));
    let wrong_receipt = EntityAccessReceipt::dangerously_assert_authenticated_user(
        f.actions.owner.clone(),
        &f.session.to_string(),
        EntityType::Document,
    );
    assert!(matches!(
        f.service
            .create(
                &wrong_receipt,
                &f.actions.owner,
                f.input(vec![json!({"subject":"x"})])
            )
            .await,
        Err(CodeModeError::Forbidden)
    ));
    f.actions.archived.store(true, Ordering::SeqCst);
    assert!(matches!(
        f.service
            .create(
                &f.edit(),
                &f.actions.owner,
                f.input(vec![json!({"subject":"x"})])
            )
            .await,
        Err(CodeModeError::Forbidden)
    ));
    assert!(f.store.0.lock().unwrap().is_empty());
}
#[tokio::test]
async fn double_submit_claims_before_work_and_never_repeats_an_action() {
    let f = Fixture::new();
    f.actions.block_actions.store(true, Ordering::SeqCst);
    let row = f.create(vec![json!({"subject":"x"})]).await;
    let decision = ReviewDecision::Submit {
        revision: row.revision,
        items: vec![],
    };
    let access = f.edit();
    let (a, b) = tokio::join!(
        f.service
            .decide(&access, &f.actions.owner, row.id, decision.clone()),
        f.service
            .decide(&access, &f.actions.owner, row.id, decision)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert!(matches!(a.err().or(b.err()), Some(CodeModeError::Conflict)));
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while f.actions.calls.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        f.store.get(f.session, row.id).await.unwrap().items[0].status,
        ReviewItemStatus::Submitting
    );
    f.actions.action_gate.notify_one();
    let final_row = f.settled(row.id).await;
    assert_eq!(final_row.items[0].status, ReviewItemStatus::Completed);
    assert_eq!(f.actions.calls.lock().unwrap().len(), 1);
    assert!(matches!(
        f.service
            .decide(
                &f.edit(),
                &f.actions.owner,
                row.id,
                ReviewDecision::Submit {
                    revision: final_row.revision,
                    items: vec![row.items[0].id]
                }
            )
            .await,
        Err(CodeModeError::Conflict)
    ));
}
#[tokio::test]
async fn send_all_preserves_successes_and_ambiguous_failure_without_retries() {
    let f = Fixture::new();
    let row = f
        .create(vec![
            json!({"subject":"one"}),
            json!({"subject":"two", "fail":true}),
            json!({"subject":"three"}),
        ])
        .await;
    f.service
        .decide(
            &f.edit(),
            &f.actions.owner,
            row.id,
            ReviewDecision::Submit {
                revision: row.revision,
                items: vec![],
            },
        )
        .await
        .unwrap();
    let completed = f.settled(row.id).await;
    assert_eq!(
        completed
            .items
            .iter()
            .map(|i| i.status.clone())
            .collect::<Vec<_>>(),
        vec![
            ReviewItemStatus::Completed,
            ReviewItemStatus::Unknown,
            ReviewItemStatus::Completed
        ]
    );
    assert_eq!(f.actions.calls.lock().unwrap().len(), 3);
    assert_eq!(f.actions.notifications.lock().unwrap().len(), 1);
}
#[tokio::test]
async fn edit_checks_saved_revision_and_draft_bounds_and_dismiss_does_not_execute() {
    let f = Fixture::new();
    let row = f.create(vec![json!({"subject":"x"})]).await;
    let edit = |revision, draft| ReviewDecision::Edit {
        revision,
        item: row.items[0].id,
        draft,
    };
    let changed = f
        .service
        .decide(
            &f.edit(),
            &f.actions.owner,
            row.id,
            edit(row.revision, json!({"subject":"edited"})),
        )
        .await
        .unwrap();
    assert!(matches!(
        f.service
            .decide(
                &f.edit(),
                &f.actions.owner,
                row.id,
                edit(row.revision, json!({"subject":"stale"}))
            )
            .await,
        Err(CodeModeError::Conflict)
    ));
    assert!(
        f.service
            .decide(
                &f.edit(),
                &f.actions.owner,
                row.id,
                edit(
                    changed.revision,
                    json!({"subject":"x".repeat(MAX_DRAFT_BYTES)})
                )
            )
            .await
            .is_err()
    );
    f.service
        .decide(
            &f.edit(),
            &f.actions.owner,
            row.id,
            ReviewDecision::Dismiss {
                revision: changed.revision,
                items: vec![],
            },
        )
        .await
        .unwrap();
    let final_row = f.settled(row.id).await;
    assert_eq!(final_row.items[0].status, ReviewItemStatus::Dismissed);
    assert!(f.actions.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn list_recovers_stale_claim_and_notification_retry_does_not_resend() {
    let f = Fixture::new();
    f.actions.fail_notification.store(true, Ordering::SeqCst);
    let mut row = f.create(vec![json!({"subject":"x"})]).await;
    row.items[0].status = ReviewItemStatus::Submitting;
    row.notification_id = Some(macro_uuid::generate_uuid_v7());
    row.updated_at -= STALE_SUBMISSION_MS + 1;
    f.store
        .0
        .lock()
        .unwrap()
        .insert((f.session, row.id.0), row.clone());
    let listed = f.service.list(&f.view(), f.execution).await.unwrap();
    assert_eq!(listed[0].items[0].status, ReviewItemStatus::Unknown);
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while f.actions.notifications.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    // A later process reads the pending outbox item after its lease expires.
    let mut saved = f.store.get(f.session, row.id).await.unwrap();
    saved.notification_attempt_at = Some(0);
    f.store
        .0
        .lock()
        .unwrap()
        .insert((f.session, row.id.0), saved);
    f.actions.fail_notification.store(false, Ordering::SeqCst);
    f.service.read(&f.view(), row.id).await.unwrap();
    let done = f.settled(row.id).await;
    assert_eq!(done.items[0].status, ReviewItemStatus::Unknown);
    assert!(f.actions.calls.lock().unwrap().is_empty());
    assert_eq!(
        f.actions.notifications.lock().unwrap().as_slice(),
        &[row.notification_id.unwrap(), row.notification_id.unwrap()]
    );
}
#[tokio::test]
async fn read_and_list_never_cross_session_scope_and_creation_is_bounded() {
    let f = Fixture::new();
    let row = f.create(vec![json!({"subject":"x"})]).await;
    let other = EntityAccessReceipt::dangerously_assert_authenticated_user(
        f.actions.owner.clone(),
        &macro_uuid::generate_uuid_v7().to_string(),
        EntityType::AgentSession,
    );
    assert!(matches!(
        f.service.read(&other, row.id).await,
        Err(CodeModeError::NotFound)
    ));
    assert!(
        f.service
            .list(&other, f.execution)
            .await
            .unwrap()
            .is_empty()
    );
    for drafts in [
        vec![],
        vec![json!({"subject":"x"}); 101],
        vec![json!({"subject":"x".repeat(MAX_DRAFT_BYTES)})],
        vec![json!({"wrong":"shape"})],
    ] {
        assert!(
            f.service
                .create(&f.edit(), &f.actions.owner, f.input(drafts))
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn standalone_presentation_completes_without_approval_or_external_dispatch() {
    let f = Fixture::new();
    let mut input = f.input(vec![json!({"subject":"Approve this proposal?"})]);
    input.execution_id = None;
    f.actions.block_actions.store(true, Ordering::SeqCst);
    let row = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        f.service.create(&f.edit(), &f.actions.owner, input),
    )
    .await
    .expect("presentation must not await user approval")
    .unwrap();
    assert!(row.execution_id.is_none());
    assert!(row.presented_at.is_some());
    assert_eq!(row.items[0].status, ReviewItemStatus::Pending);
    assert!(f.actions.calls.lock().unwrap().is_empty());
    assert!(f.actions.notifications.lock().unwrap().is_empty());
    assert_eq!(*f.actions.presentations.lock().unwrap(), vec![row.id]);
    f.service.read(&f.view(), row.id).await.unwrap();
    assert_eq!(*f.actions.presentations.lock().unwrap(), vec![row.id]);
}

#[tokio::test]
async fn interrupted_presentation_preserves_review_and_retries_same_identity() {
    let f = Fixture::new();
    f.actions.fail_presentation.store(true, Ordering::SeqCst);
    assert!(
        f.service
            .create(
                &f.edit(),
                &f.actions.owner,
                f.input(vec![json!({"subject":"Which?"})])
            )
            .await
            .is_err()
    );
    let row = f.store.0.lock().unwrap().values().next().unwrap().clone();
    assert!(row.presented_at.is_none());
    assert!(matches!(
        f.service
            .decide(
                &f.edit(),
                &f.actions.owner,
                row.id,
                ReviewDecision::Submit {
                    revision: row.revision,
                    items: vec![]
                },
            )
            .await,
        Err(CodeModeError::Conflict)
    ));
    assert!(f.actions.calls.lock().unwrap().is_empty());
    f.actions.fail_presentation.store(false, Ordering::SeqCst);
    let recovered = f.service.read(&f.view(), row.id).await.unwrap();
    assert!(recovered.presented_at.is_some());
    assert_eq!(recovered.id, row.id);
    assert_eq!(
        *f.actions.presentations.lock().unwrap(),
        vec![row.id, row.id]
    );
    assert_eq!(f.store.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn native_presentation_checks_authenticated_and_current_owner() {
    let f = Fixture::new();
    let mut session = agent_session::testing::test_agent_session(f.session);
    // The test session's owner differs from the authoritative review owner.
    let mut input = f.input(vec![json!({"subject":"Which?"})]);
    input.execution_id = None;
    assert!(matches!(
        f.service
            .create_for_session(&session, &f.actions.owner, input.clone())
            .await,
        Err(CodeModeError::Forbidden)
    ));
    session.owner_id = f.actions.owner.clone().into();
    let row = f
        .service
        .create_for_session(&session, &f.actions.owner, input.clone())
        .await
        .unwrap();
    assert!(row.execution_id.is_none());
    f.actions.archived.store(true, Ordering::SeqCst);
    assert!(matches!(
        f.service
            .create_for_session(&session, &f.actions.owner, input)
            .await,
        Err(CodeModeError::Forbidden)
    ));
}

#[test]
fn questions_use_acp_instead_of_the_saved_review_contract() {
    assert!(
        serde_json::from_value::<CreateReview>(json!({
            "kind":"question", "title":"Choose", "drafts":[{"question":"Which?"}]
        }))
        .is_err()
    );
}
