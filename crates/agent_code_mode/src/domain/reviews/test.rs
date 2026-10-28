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
struct Store(
    Mutex<HashMap<(AgentSessionId, Uuid), ReviewRecord>>,
    tokio::sync::Notify,
    Mutex<Vec<PendingNotification>>,
);
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
    async fn save(
        &self,
        expected: i64,
        record: &ReviewRecord,
        notification: Option<&PendingNotification>,
    ) -> Result<(), CodeModeError> {
        let mut rows = self.0.lock().unwrap();
        let current = rows
            .get_mut(&(record.session_id, record.id.0))
            .ok_or(CodeModeError::NotFound)?;
        if current.revision != expected {
            return Err(CodeModeError::Conflict);
        }
        *current = record.clone();
        if let Some(notification) = notification {
            self.2.lock().unwrap().push(notification.clone());
        }
        self.1.notify_waiters();
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
            acting_as: None,
            turn_id: None,
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
    prompter: Mutex<Option<TurnPrompter>>,
    calls: Mutex<Vec<Value>>,
    actors: Mutex<Vec<String>>,
    presentations: Mutex<Vec<ReviewId>>,
    views: Mutex<Vec<(AgentSessionId, PresentedView)>>,
    fail_presentation: AtomicBool,
    block_actions: AtomicBool,
    action_gate: tokio::sync::Notify,
    action_started: tokio::sync::Notify,
    approvable: AtomicBool,
}
#[async_trait]
impl ReviewActions for Actions {
    async fn session(&self, _: AgentSessionId) -> Result<ReviewSession, CodeModeError> {
        Ok(ReviewSession {
            owner: self.owner.clone(),
            archived: self.archived.load(Ordering::SeqCst),
            prompter: self.prompter.lock().unwrap().clone(),
        })
    }
    async fn approvable(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<bool, CodeModeError> {
        assert_eq!(
            Some(account_holder),
            record.acting_user.as_ref().or(Some(&self.owner))
        );
        Ok(self.approvable.load(Ordering::SeqCst))
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
        _: &ReviewRecord,
        draft: Value,
    ) -> Result<Value, CodeModeError> {
        self.actors.lock().unwrap().push(owner.to_string());
        self.calls.lock().unwrap().push(draft.clone());
        self.action_started.notify_one();
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
    async fn present_view(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: AgentSessionId,
        view: &PresentedView,
    ) -> Result<(), CodeModeError> {
        assert_eq!(owner, &self.owner);
        self.views.lock().unwrap().push((session, view.clone()));
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
            prompter: Mutex::new(None),
            calls: Mutex::default(),
            actors: Mutex::default(),
            presentations: Mutex::default(),
            views: Mutex::default(),
            fail_presentation: AtomicBool::new(false),
            block_actions: AtomicBool::new(false),
            action_gate: tokio::sync::Notify::new(),
            action_started: tokio::sync::Notify::new(),
            approvable: AtomicBool::new(true),
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
                let changed = self.store.1.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                let row = self.store.get(self.session, id).await.unwrap();
                if row
                    .items
                    .iter()
                    .all(|item| item.status != ReviewItemStatus::Submitting)
                {
                    return row;
                }
                changed.await;
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
    f.actions.action_started.notified().await;
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
    assert_eq!(f.store.2.lock().unwrap().len(), 2);
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
async fn list_recovers_stale_claim_without_repeating_external_work() {
    let f = Fixture::new();
    let mut row = f.create(vec![json!({"subject":"x"})]).await;
    row.items[0].status = ReviewItemStatus::Submitting;
    row.decision = Some(ReviewDecisionContext {
        by: f.actions.owner.to_string(),
        via: DecisionVia::Card,
        revision: row.revision,
        items: vec![row.items[0].id],
    });
    row.updated_at -= STALE_SUBMISSION_MS + 1;
    f.store
        .0
        .lock()
        .unwrap()
        .insert((f.session, row.id.0), row.clone());
    let listed = f.service.list(&f.view(), f.execution).await.unwrap();
    assert_eq!(listed[0].items[0].status, ReviewItemStatus::Unknown);
    assert!(f.actions.calls.lock().unwrap().is_empty());
    let events = f.store.2.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(
        events[0].notification.event,
        NotificationEvent::ReviewSettled(_)
    ));
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
    assert!(f.store.2.lock().unwrap().is_empty());
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

#[tokio::test]
async fn a_system_turn_cannot_approve_even_with_owner_credentials() {
    let f = Fixture::new();
    let row = f.create(vec![json!({"subject":"x"})]).await;
    *f.actions.prompter.lock().unwrap() = Some(TurnPrompter {
        action_id: agent_runtime_protocol::domain::action::AgentActionId::mint(),
        user: Some(f.actions.owner.clone()),
        kind: agent_session::domain::model::PrompterKind::System,
    });
    let decision = ReviewDecision::Submit {
        revision: row.revision,
        items: vec![],
    };
    assert!(matches!(
        f.service
            .decide_for_session(f.session, &f.actions.owner, row.id, decision.clone())
            .await,
        Err(CodeModeError::Forbidden)
    ));
    assert!(f.actions.calls.lock().unwrap().is_empty());
    f.actions.prompter.lock().unwrap().as_mut().unwrap().kind =
        agent_session::domain::model::PrompterKind::User;
    f.service
        .decide_for_session(f.session, &f.actions.owner, row.id, decision)
        .await
        .unwrap();
    let settled = f.settled(row.id).await;
    assert_eq!(settled.items[0].status, ReviewItemStatus::Completed);
    let events = f.store.2.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert!(events.iter().all(|event| event.wake));
    assert!(
        matches!(&events[1].notification.event, NotificationEvent::ReviewSettled(ReviewSettlement::Actions(outcome)) if outcome.by == f.actions.owner.as_ref() && outcome.via == DecisionVia::Chat)
    );
}

#[tokio::test]
async fn a_started_import_waits_quietly_for_its_write_to_settle() {
    let f = Fixture::new();
    let mut input = f.input(vec![json!({"subject":"plan"})]);
    input.kind = ReviewKind::Import;
    let row = f
        .service
        .create(&f.edit(), &f.actions.owner, input)
        .await
        .unwrap();

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
    let started = f.settled(row.id).await;

    assert_eq!(started.items[0].status, ReviewItemStatus::Completed);
    let events = f.store.2.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(
        events[0].notification.event,
        NotificationEvent::ReviewDecided(_)
    ));
    assert!(!events[0].wake);
}

#[tokio::test]
async fn an_import_that_could_not_start_settles_and_wakes() {
    let f = Fixture::new();
    let mut input = f.input(vec![json!({"subject":"plan", "fail": true})]);
    input.kind = ReviewKind::Import;
    let row = f
        .service
        .create(&f.edit(), &f.actions.owner, input)
        .await
        .unwrap();

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
    let ended = f.settled(row.id).await;

    assert_eq!(ended.items[0].status, ReviewItemStatus::Unknown);
    let events = f.store.2.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert!(!events[0].wake);
    assert!(matches!(
        events[1].notification.event,
        NotificationEvent::ReviewSettled(ReviewSettlement::Actions(_))
    ));
    assert!(events[1].wake);
}

#[tokio::test]
async fn dismissing_an_import_wakes_the_session() {
    let f = Fixture::new();
    let mut input = f.input(vec![json!({"subject":"plan"})]);
    input.kind = ReviewKind::Import;
    let row = f
        .service
        .create(&f.edit(), &f.actions.owner, input)
        .await
        .unwrap();

    f.service
        .decide(
            &f.edit(),
            &f.actions.owner,
            row.id,
            ReviewDecision::Dismiss {
                revision: row.revision,
                items: vec![],
            },
        )
        .await
        .unwrap();

    let events = f.store.2.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert!(events[0].wake);
    assert!(f.actions.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn requester_reviews_are_decided_and_executed_only_with_their_account() {
    let f = Fixture::new();
    let requester = MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    let access = EntityAccessReceipt::dangerously_assert_authenticated_user(
        requester.clone(),
        &f.session.to_string(),
        EntityType::AgentSession,
    );
    let row = f
        .service
        .create(
            &access,
            &requester,
            f.input(vec![json!({"subject":"requester draft"})]),
        )
        .await
        .unwrap();
    assert_eq!(row.acting_user.as_ref(), Some(&requester));
    let decision = ReviewDecision::Submit {
        revision: row.revision,
        items: vec![],
    };
    assert!(matches!(
        f.service
            .decide(&f.edit(), &f.actions.owner, row.id, decision.clone())
            .await,
        Err(CodeModeError::Forbidden)
    ));
    f.service
        .decide(&access, &requester, row.id, decision)
        .await
        .unwrap();
    let settled = f.settled(row.id).await;
    assert_eq!(settled.items[0].status, ReviewItemStatus::Completed);
    assert_eq!(
        *f.actions.actors.lock().unwrap(),
        vec![requester.to_string()]
    );
}

#[tokio::test]
async fn a_chat_submit_waits_until_the_review_is_approvable() {
    let f = Fixture::new();
    let row = f.create(vec![json!({"subject":"x"})]).await;
    *f.actions.prompter.lock().unwrap() = Some(TurnPrompter {
        action_id: agent_runtime_protocol::domain::action::AgentActionId::mint(),
        user: Some(f.actions.owner.clone()),
        kind: agent_session::domain::model::PrompterKind::User,
    });
    let submit = ReviewDecision::Submit {
        revision: row.revision,
        items: vec![],
    };
    f.actions.approvable.store(false, Ordering::SeqCst);

    assert!(matches!(
        f.service
            .decide_for_session(f.session, &f.actions.owner, row.id, submit.clone())
            .await,
        Err(CodeModeError::Invalid(_))
    ));
    let unsaved = f.store.get(f.session, row.id).await.unwrap();
    assert_eq!(unsaved.revision, row.revision);
    assert_eq!(unsaved.items[0].status, ReviewItemStatus::Pending);
    assert!(f.actions.calls.lock().unwrap().is_empty());

    f.actions.approvable.store(true, Ordering::SeqCst);
    let approved = f
        .service
        .decide_for_session(f.session, &f.actions.owner, row.id, submit)
        .await
        .unwrap();
    assert_eq!(approved.decision.unwrap().via, DecisionVia::Chat);
    let settled = f.settled(row.id).await;
    assert_eq!(settled.items[0].status, ReviewItemStatus::Completed);
}

fn a_view() -> Value {
    json!({ "title": "Launch", "widgets": [{ "type": "md", "markdown": "Shipped." }] })
}

#[tokio::test]
async fn a_view_is_presented_to_the_session_and_nothing_is_saved() {
    let f = Fixture::new();
    f.service
        .present_view(
            &f.edit(),
            &f.actions.owner,
            PresentView {
                view: a_view(),
                execution_id: Some(f.execution),
            },
        )
        .await
        .unwrap();
    let views = f.actions.views.lock().unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].0, f.session);
    assert_eq!(views[0].1.view, a_view());
    assert!(f.store.0.lock().unwrap().is_empty());
    assert!(f.store.2.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_view_the_renderer_would_not_draw_is_turned_back_with_what_to_fix() {
    let f = Fixture::new();
    let widgets = (0..12)
        .map(|_| json!({ "type": "chart" }))
        .collect::<Vec<_>>();
    let Err(CodeModeError::Invalid(message)) = f
        .service
        .present_view(
            &f.edit(),
            &f.actions.owner,
            PresentView {
                view: json!({ "widgets": widgets }),
                execution_id: None,
            },
        )
        .await
    else {
        panic!("the view is turned back");
    };
    let types = r#""md", "timeline", "list", "channelMessage", "container""#;
    let listed = (0..10)
        .map(|index| format!("- view.widgets[{index}].type should be one of {types}\n"))
        .collect::<String>();
    assert_eq!(
        message,
        format!(
            "The view was not presented: it does not match the PresentView schema.\n{listed}- and 2 more\nFix these and present the whole view again."
        )
    );
    assert!(f.actions.views.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_oversized_view_is_turned_back() {
    let f = Fixture::new();
    let view = json!({ "widgets": [{ "type": "md", "markdown": "x".repeat(40 * 1024) }] });
    assert!(matches!(
        f.service
            .present_view(
                &f.edit(),
                &f.actions.owner,
                PresentView {
                    view,
                    execution_id: None
                }
            )
            .await,
        Err(CodeModeError::Invalid(message)) if message.contains("over the 32768-byte limit")
    ));
    assert!(f.actions.views.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_view_is_presented_only_by_its_session_and_execution() {
    let f = Fixture::new();
    let stranger = MacroUserIdStr::parse_from_str("macro|other@macro.local")
        .unwrap()
        .into_owned();
    let input = |execution_id| PresentView {
        view: a_view(),
        execution_id,
    };
    assert!(matches!(
        f.service
            .present_view(&f.edit(), &stranger, input(None))
            .await,
        Err(CodeModeError::Forbidden)
    ));
    assert!(matches!(
        f.service
            .present_view(
                &f.edit(),
                &f.actions.owner,
                input(Some(ExecutionId::mint()))
            )
            .await,
        Err(CodeModeError::NotFound)
    ));
    let mut session = agent_session::testing::test_agent_session(f.session);
    // The test session's owner differs from the authoritative session owner.
    assert!(matches!(
        f.service
            .present_view_for_session(&session, &f.actions.owner, input(None))
            .await,
        Err(CodeModeError::Forbidden)
    ));
    session.owner_id = f.actions.owner.clone().into();
    f.service
        .present_view_for_session(&session, &f.actions.owner, input(None))
        .await
        .unwrap();
    f.actions.archived.store(true, Ordering::SeqCst);
    assert!(matches!(
        f.service
            .present_view_for_session(&session, &f.actions.owner, input(None))
            .await,
        Err(CodeModeError::Forbidden)
    ));
    assert_eq!(f.actions.views.lock().unwrap().len(), 1);
}
