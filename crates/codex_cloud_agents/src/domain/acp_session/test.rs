use super::*;
fn text(value: &str) -> Vec<agent_client_protocol::schema::v1::ContentBlock> {
    vec![agent_client_protocol::schema::v1::ContentBlock::Text(
        agent_client_protocol::schema::v1::TextContent::new(value),
    )]
}
use crate::domain::cloud::CloudConversation;
use crate::domain::cloud::{CloudEventStream, CloudTasks, CreatedTask, TaskSnapshot, TurnSnapshot};
use crate::domain::{CredentialStore, OAuth, Probe};
use crate::domain::{Credentials, DeviceLogin, Environment, LoginPoll, Secret};
use std::sync::Mutex;
use std::sync::atomic::AtomicUsize;

#[derive(Default, Clone)]
struct Journal(
    Arc<Mutex<HashMap<String, StoredSession>>>,
    Arc<Mutex<HashMap<String, Vec<JournalEntry>>>>,
);
impl SessionStore for Journal {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().insert(id.to_owned(), state.clone());
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
    async fn validate(&self) -> Result<(), rootcause::Report> {
        Ok(())
    }
}
struct Auth;
impl CredentialStore for Auth {
    fn load(&self) -> Result<Option<Credentials>, rootcause::Report> {
        Ok(Some(Credentials {
            version: 1,
            access_token: Secret::new("test-access".into())?,
            refresh_token: Secret::new("test-refresh".into())?,
            expires_at: u64::MAX,
            account_id: "test-account".into(),
        }))
    }
    fn save(&self, _: &Credentials) -> Result<(), rootcause::Report> {
        Ok(())
    }
    fn clear(&self) -> Result<(), rootcause::Report> {
        Ok(())
    }
}
#[derive(Default)]
struct Sink(Mutex<Vec<CloudEvent>>);
impl SessionSink for Sink {
    fn emit(&self, event: &CloudEvent) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().push(event.clone());
        Ok(())
    }
}
#[derive(Default)]
struct State {
    creates: AtomicUsize,
    followups: AtomicUsize,
    allow_follow_up: bool,
    streams: AtomicUsize,
    running: AtomicBool,
    cancels: AtomicUsize,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
    ambiguous: bool,
    paused: bool,
    native: Option<Vec<NativeRecord>>,
}
struct Provider(Arc<State>);
impl OAuth for Provider {
    async fn begin(&self) -> Result<DeviceLogin, rootcause::Report> {
        Err(rootcause::report!("unused"))
    }
    async fn poll(&self, _: &DeviceLogin) -> Result<LoginPoll, rootcause::Report> {
        Err(rootcause::report!("unused"))
    }
    async fn refresh(&self, _: &Credentials) -> Result<Credentials, rootcause::Report> {
        Err(rootcause::report!("unused"))
    }
    async fn environments(&self, _: &Credentials) -> Result<Vec<Environment>, rootcause::Report> {
        Ok(vec![Environment {
            id: "env_test".into(),
            label: None,
            repositories: vec![],
        }])
    }
}
fn snapshot(turn: &str, status: &str) -> TaskSnapshot {
    TaskSnapshot {
        native: None,
        pull_requests: vec![],
        task_id: CloudId::new("task_test".into()).unwrap(),
        title: None,
        assistant_status: Some(status.into()),
        turns: vec![TurnSnapshot {
            source: "current_assistant_turn".into(),
            id: Some(turn.into()),
            messages: vec![],
            output_types: vec![],
            has_diff: false,
        }],
    }
}
impl CloudTasks for Provider {
    async fn create(&self, _: &Credentials, _: &Launch) -> Result<CreatedTask, rootcause::Report> {
        self.0.creates.fetch_add(1, Ordering::SeqCst);
        self.0.entered.notify_one();
        if self.0.paused {
            self.0.release.notified().await;
        }
        if self.0.ambiguous {
            return Err(rootcause::report!("acceptance unknown"));
        }
        Ok(CreatedTask {
            task_id: CloudId::new("task_test".into())?,
            assistant_turn_id: Some(TurnId::new("turn_new".into())?),
            url: "https://example.test/task".into(),
        })
    }
    async fn snapshot(
        &self,
        _: &Credentials,
        _: &CloudId,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        Ok(snapshot(
            if self.0.allow_follow_up {
                "turn_new"
            } else {
                "turn_external"
            },
            "completed",
        ))
    }
}
impl CloudConversation for Provider {
    async fn follow_up(
        &self,
        _: &Credentials,
        _: &CloudId,
        _: &TurnId,
        _: &str,
    ) -> Result<CreatedTask, rootcause::Report> {
        assert!(self.0.allow_follow_up, "unexpected follow-up");
        self.0.followups.fetch_add(1, Ordering::SeqCst);
        Ok(CreatedTask {
            task_id: CloudId::new("task_test".into())?,
            assistant_turn_id: Some(TurnId::new("turn_follow".into())?),
            url: "https://example.test/task".into(),
        })
    }
    async fn cancel(&self, _: &Credentials, _: &CloudId) -> Result<(), rootcause::Report> {
        self.0.cancels.fetch_add(1, Ordering::SeqCst);
        self.0.running.store(false, Ordering::SeqCst);
        Ok(())
    }
    async fn turn(
        &self,
        _: &Credentials,
        _: &CloudId,
        _: &TurnId,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        Ok(snapshot(
            "turn_new",
            if self.0.allow_follow_up {
                "completed"
            } else if self.0.running.load(Ordering::SeqCst) {
                "in_progress"
            } else {
                "cancelled"
            },
        ))
    }
    async fn stream(
        &self,
        _: &Credentials,
        _: &CloudId,
        _: &TurnId,
    ) -> Result<CloudEventStream, rootcause::Report> {
        self.0.streams.fetch_add(1, Ordering::SeqCst);
        if let Some(records) = &self.0.native {
            return Ok(Box::pin(futures::stream::iter(
                records.clone().into_iter().map(Ok),
            )));
        }
        Ok(Box::pin(futures::stream::empty()))
    }
}
fn service(state: Arc<State>, journal: Journal) -> SessionService<Probe<Provider, Auth>, Journal> {
    SessionService::new(
        Arc::new(Probe::new(Provider(state), Auth)),
        journal,
        Some(crate::domain::runtime::CloudTarget {
            environment: CloudId::new("env_test".into()).unwrap(),
            branch: "main".into(),
            repository_url: None,
        }),
    )
}
#[tokio::test]
async fn ambiguous_submission_is_checkpointed_and_never_retried() {
    let state = Arc::new(State {
        ambiguous: true,
        ..Default::default()
    });
    let journal = Journal::default();
    let service = service(state.clone(), journal.clone());
    let id = service.new_session().await.unwrap();
    let sink = Sink::default();
    assert!(service.prompt(&id, text("hello"), &sink).await.is_err());
    assert!(journal.load(&id).await.unwrap().unwrap().uncertain_write);
    assert!(service.prompt(&id, text("retry"), &sink).await.is_err());
    assert_eq!(state.creates.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn concurrent_prompt_is_rejected_and_cancel_during_create_reaches_remote_receipt() {
    let state = Arc::new(State {
        paused: true,
        ..Default::default()
    });
    let service = service(state.clone(), Journal::default());
    let id = service.new_session().await.unwrap();
    let sink = Sink::default();
    let prompt = service.prompt(&id, text("hello"), &sink);
    tokio::pin!(prompt);
    tokio::select! {
        _ = &mut prompt => panic!("creation should pause"),
        _ = state.entered.notified() => {}
    }
    assert!(service.prompt(&id, text("parallel"), &sink).await.is_err());
    service.cancel(&id).await.unwrap();
    assert_eq!(state.cancels.load(Ordering::SeqCst), 0);
    state.release.notify_one();
    assert!(matches!(prompt.await.unwrap(), Outcome::Cancelled));
    assert_eq!(state.creates.load(Ordering::SeqCst), 1);
    assert_eq!(state.cancels.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn stale_parent_refuses_provider_follow_up() {
    let state = Arc::new(State::default());
    let journal = Journal::default();
    let id = uuid::Uuid::now_v7().to_string();
    journal
        .save(
            &id,
            &StoredSession {
                account_id: "test-account".into(),
                connection_id: "test-account".into(),
                target: Some(crate::domain::runtime::CloudTarget {
                    environment: CloudId::new("env_test".into()).unwrap(),
                    branch: "main".into(),
                    repository_url: None,
                }),
                task: Some("task_test".into()),
                turn: Some("turn_old".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    journal
        .append(&id, 0, None, &JournalInput::HistoryComplete)
        .await
        .unwrap();
    let service = service(state.clone(), journal);
    let error = service
        .prompt(&id, text("hello"), &Sink::default())
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("advanced outside"));
    assert_eq!(state.creates.load(Ordering::SeqCst), 0);
}

struct FailingReceiptJournal(Journal);
impl SessionStore for FailingReceiptJournal {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        self.0.load(id).await
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        if state.task.is_some() {
            return Err(rootcause::report!("injected receipt disk failure"));
        }
        self.0.save(id, state).await
    }
    async fn read(&self, id: &str) -> Result<Vec<JournalEntry>, rootcause::Report> {
        self.validate().await?;
        self.0.read(id).await
    }
    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> Result<JournalEntry, rootcause::Report> {
        self.validate().await?;
        self.0.append(id, expected, turn, input).await
    }
    async fn validate(&self) -> Result<(), rootcause::Report> {
        Ok(())
    }
}
#[tokio::test]
async fn receipt_persistence_failure_keeps_session_uncertain_in_memory_and_on_disk() {
    let state = Arc::new(State::default());
    let journal = Journal::default();
    let service = SessionService::new(
        Arc::new(Probe::new(Provider(state.clone()), Auth)),
        FailingReceiptJournal(journal.clone()),
        Some(crate::domain::runtime::CloudTarget {
            environment: CloudId::new("env_test".into()).unwrap(),
            branch: "main".into(),
            repository_url: None,
        }),
    );
    let id = service.new_session().await.unwrap();
    let sink = Sink::default();
    assert!(service.prompt(&id, text("hello"), &sink).await.is_err());
    assert!(journal.load(&id).await.unwrap().unwrap().uncertain_write);
    assert!(service.prompt(&id, text("retry"), &sink).await.is_err());
    assert_eq!(state.creates.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn loading_session_from_another_account_rejects_replay_before_emitting_content() {
    let journal = Journal::default();
    let id = uuid::Uuid::now_v7().to_string();
    journal
        .save(
            &id,
            &StoredSession {
                account_id: "another-account".into(),
                target: Some(crate::domain::runtime::CloudTarget {
                    environment: CloudId::new("env_test".into()).unwrap(),
                    branch: "main".into(),
                    repository_url: None,
                }),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let service = service(Arc::new(State::default()), journal);
    let sink = Sink::default();
    assert!(service.replay(&id, &sink).await.is_err());
    assert!(sink.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn restart_reattaches_saved_turn_without_launching_again() {
    let provider = Arc::new(State::default());
    let journal = Journal::default();
    let original = service(provider.clone(), journal.clone());
    let id = original.new_session().await.unwrap();
    original
        .prompt(&id, text("first"), &Sink::default())
        .await
        .unwrap();
    drop(original);
    let restarted = service(provider.clone(), journal);
    restarted.replay(&id, &Sink::default()).await.unwrap();
    assert!(matches!(
        restarted
            .resume_observation(&id, &Sink::default())
            .await
            .unwrap(),
        Some(Outcome::Cancelled)
    ));
    assert_eq!(provider.creates.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn deterministic_host_identity_recovers_new_session_response_loss() {
    let provider = Arc::new(State::default());
    let journal = Journal::default();
    let id = uuid::Uuid::now_v7().to_string();
    let original = service(provider.clone(), journal.clone()).with_session_id(id.clone());
    assert_eq!(original.new_session().await.unwrap(), id);
    original
        .prompt(&id, text("first"), &Sink::default())
        .await
        .unwrap();
    let restarted = service(provider.clone(), journal).with_session_id(id.clone());
    assert_eq!(restarted.new_session().await.unwrap(), id);
    assert_eq!(provider.creates.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn restarted_running_turn_observes_and_cancels_without_creation() {
    let provider = Arc::new(State::default());
    provider.running.store(true, Ordering::SeqCst);
    let journal = Journal::default();
    let original = service(provider.clone(), journal.clone());
    let id = original.new_session().await.unwrap();
    let mut stored = journal.load(&id).await.unwrap().unwrap();
    stored.target = Some(CloudTarget {
        environment: CloudId::new("env_test".into()).unwrap(),
        branch: "main".into(),
        repository_url: None,
    });
    stored.task = Some("task_test".into());
    stored.turn = Some("turn_new".into());
    journal.save(&id, &stored).await.unwrap();
    drop(original);
    let restarted = Arc::new(service(provider.clone(), journal));
    let observing = {
        let restarted = restarted.clone();
        let id = id.clone();
        tokio::spawn(async move { restarted.resume_observation(&id, &Sink::default()).await })
    };
    while provider.streams.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    assert!(!observing.is_finished());
    restarted.cancel(&id).await.unwrap();
    tokio::time::advance(Duration::from_secs(5)).await;
    assert!(matches!(
        observing.await.unwrap().unwrap(),
        Some(Outcome::Cancelled)
    ));
    assert_eq!(provider.creates.load(Ordering::SeqCst), 0);
    assert_eq!(provider.cancels.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn prompt_immediately_after_load_waits_for_recovery_then_follows_same_task() {
    let provider = Arc::new(State {
        allow_follow_up: true,
        ..State::default()
    });
    let journal = Journal::default();
    let original = service(provider.clone(), journal.clone());
    let id = original.new_session().await.unwrap();
    original
        .prompt(&id, text("first"), &Sink::default())
        .await
        .unwrap();
    drop(original);
    let restarted = Arc::new(service(provider.clone(), journal));
    let recovery = restarted
        .prepare_recovery(&id, &Sink::default())
        .await
        .unwrap();
    let followup = {
        let restarted = restarted.clone();
        let id = id.clone();
        tokio::spawn(async move {
            restarted
                .prompt(&id, text("continue"), &Sink::default())
                .await
        })
    };
    tokio::task::yield_now().await;
    assert!(!followup.is_finished());
    restarted
        .finish_recovery(&id, recovery, &Sink::default())
        .await
        .unwrap();
    assert!(matches!(
        followup.await.unwrap().unwrap(),
        Outcome::Completed
    ));
    assert_eq!(provider.creates.load(Ordering::SeqCst), 1);
    assert_eq!(provider.followups.load(Ordering::SeqCst), 1);
}

#[derive(Clone)]
struct FencedJournal {
    inner: Journal,
    fenced: Arc<AtomicBool>,
}
impl SessionStore for FencedJournal {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        self.inner.load(id).await
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        self.validate().await?;
        self.inner.save(id, state).await
    }
    async fn read(&self, id: &str) -> Result<Vec<JournalEntry>, rootcause::Report> {
        self.validate().await?;
        self.inner.read(id).await
    }
    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> Result<JournalEntry, rootcause::Report> {
        self.validate().await?;
        self.inner.append(id, expected, turn, input).await
    }
    async fn validate(&self) -> Result<(), rootcause::Report> {
        if self.fenced.load(Ordering::SeqCst) {
            Err(rootcause::report!("fenced out"))
        } else {
            Ok(())
        }
    }
}
#[tokio::test]
async fn prompt_waiting_for_recovery_revalidates_fence_before_provider_work() {
    let provider = Arc::new(State {
        allow_follow_up: true,
        ..State::default()
    });
    let fenced = Arc::new(AtomicBool::new(false));
    let service = Arc::new(SessionService::new(
        Arc::new(Probe::new(Provider(provider.clone()), Auth)),
        FencedJournal {
            inner: Journal::default(),
            fenced: fenced.clone(),
        },
        Some(crate::domain::runtime::CloudTarget {
            environment: CloudId::new("env_test".into()).unwrap(),
            branch: "main".into(),
            repository_url: None,
        }),
    ));
    let id = service.new_session().await.unwrap();
    let recovery = service
        .prepare_recovery(&id, &Sink::default())
        .await
        .unwrap();
    let waiting = {
        let service = service.clone();
        tokio::spawn(async move { service.prompt(&id, text("first"), &Sink::default()).await })
    };
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());
    fenced.store(true, Ordering::SeqCst);
    drop(recovery);
    let result = waiting.await.unwrap();
    assert!(result.err().unwrap().to_string().contains("fenced out"));
    assert_eq!(provider.creates.load(Ordering::SeqCst), 0);
    assert_eq!(provider.followups.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn malformed_native_input_is_durable_before_decode_failure() {
    let journal = Journal::default();
    let provider = Arc::new(State {
        running: AtomicBool::new(true),
        native: Some(vec![NativeRecord {
            event: "future".into(),
            id: None,
            data: "not json".into(),
        }]),
        ..State::default()
    });
    let service = service(provider.clone(), journal.clone());
    let id = service.new_session().await.unwrap();
    let sink = Sink::default();
    assert!(service.prompt(&id, text("hello"), &sink).await.is_err());
    let entries = journal.read(&id).await.unwrap();
    assert!(entries.iter().any(
        |entry| matches!(&entry.input, JournalInput::Native(record) if record.data == "not json")
    ));
    assert!(entries.iter().any(|entry| matches!(&entry.input, JournalInput::PromptAccepted {task,..} if task == "task_test")));
    assert_eq!(provider.creates.load(Ordering::SeqCst), 1);
    assert_eq!(sink.0.lock().unwrap().len(), 1);
    service.cancel(&id).await.unwrap();
    assert_eq!(provider.cancels.load(Ordering::SeqCst), 1);
}

struct FailingNativeJournal(Journal);
impl SessionStore for FailingNativeJournal {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        self.0.load(id).await
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        self.0.save(id, state).await
    }
    async fn read(&self, id: &str) -> Result<Vec<JournalEntry>, rootcause::Report> {
        self.0.read(id).await
    }
    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> Result<JournalEntry, rootcause::Report> {
        if matches!(input, JournalInput::Native(_)) {
            return Err(rootcause::report!("injected append failure"));
        }
        self.0.append(id, expected, turn, input).await
    }
    async fn validate(&self) -> Result<(), rootcause::Report> {
        Ok(())
    }
}
#[tokio::test]
async fn failed_native_append_never_delivers_unpersisted_provider_output() {
    let journal = Journal::default();
    let provider = Arc::new(State {
        running: AtomicBool::new(true),
        native: Some(vec![NativeRecord::from_event(CloudEvent {
            id: "private-output".into(),
            method: "item/agentMessage/delta".into(),
            params: serde_json::json!({"delta":"must not escape"}),
        })]),
        ..State::default()
    });
    let service = SessionService::new(
        Arc::new(Probe::new(Provider(provider.clone()), Auth)),
        FailingNativeJournal(journal.clone()),
        Some(crate::domain::runtime::CloudTarget {
            environment: CloudId::new("env_test".into()).unwrap(),
            branch: "main".into(),
            repository_url: None,
        }),
    );
    let id = service.new_session().await.unwrap();
    let sink = Sink::default();
    assert!(service.prompt(&id, text("hello"), &sink).await.is_err());
    assert_eq!(sink.0.lock().unwrap().len(), 1);
    assert!(
        !journal
            .read(&id)
            .await
            .unwrap()
            .iter()
            .any(|entry| matches!(entry.input, JournalInput::Native(_)))
    );
    assert_eq!(provider.creates.load(Ordering::SeqCst), 1);
}

#[derive(Default)]
struct HostedRecoverySink(AtomicBool);
impl SessionSink for HostedRecoverySink {
    fn emit(&self, _: &CloudEvent) -> Result<(), rootcause::Report> {
        self.0.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn recovered(&self) -> Result<bool, rootcause::Report> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
#[tokio::test]
async fn recovered_history_requires_successful_replacement_before_followup_dispatch() {
    let provider = Arc::new(State {
        allow_follow_up: true,
        ..State::default()
    });
    let journal = Journal::default();
    let initial = service(provider.clone(), journal.clone());
    let id = initial.new_session().await.unwrap();
    let mut stored = journal.load(&id).await.unwrap().unwrap();
    stored.target = Some(CloudTarget {
        environment: CloudId::new("env_test".into()).unwrap(),
        branch: "main".into(),
        repository_url: None,
    });
    stored.task = Some("task_test".into());
    stored.turn = Some("turn_new".into());
    journal.save(&id, &stored).await.unwrap();
    drop(initial);
    let service = Arc::new(service(provider.clone(), journal));
    let recovery = service
        .prepare_recovery(&id, &Sink::default())
        .await
        .unwrap();
    service
        .finish_recovery(&id, recovery, &HostedRecoverySink::default())
        .await
        .unwrap();
    let waiting = {
        let service = service.clone();
        let id = id.clone();
        tokio::spawn(async move {
            service
                .prompt(&id, text("continue"), &Sink::default())
                .await
        })
    };
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());
    assert_eq!(provider.followups.load(Ordering::SeqCst), 0);
    let replacement = service
        .prepare_recovery(&id, &Sink::default())
        .await
        .unwrap();
    tokio::task::yield_now().await;
    assert_eq!(provider.followups.load(Ordering::SeqCst), 0);
    service
        .finish_recovery(&id, replacement, &Sink::default())
        .await
        .unwrap();
    assert!(matches!(
        waiting.await.unwrap().unwrap(),
        Outcome::Completed
    ));
    assert_eq!(provider.followups.load(Ordering::SeqCst), 1);
    assert_eq!(provider.creates.load(Ordering::SeqCst), 0);
}

#[test]
fn old_session_target_layout_is_rejected() {
    let old = serde_json::json!({"account_id":"account","connection_id":"connection","environment":"old","branch":"main","task":null,"turn":null,"uncertain_write":false});
    assert!(serde_json::from_value::<StoredSession>(old).is_err());
    assert!(
        serde_json::from_value::<StoredSession>(
            serde_json::to_value(StoredSession::default()).unwrap()
        )
        .is_ok()
    );
}

#[tokio::test]
async fn saved_task_without_target_is_rejected_instead_of_selecting_a_new_one() {
    let journal = Journal::default();
    let provider = Arc::new(State::default());
    let first = service(provider.clone(), journal.clone());
    let id = first.new_session().await.unwrap();
    let mut stored = journal.load(&id).await.unwrap().unwrap();
    stored.task = Some("task_test".into());
    stored.turn = Some("turn_new".into());
    journal.save(&id, &stored).await.unwrap();
    drop(first);
    let restarted = service(provider.clone(), journal);
    let error = restarted
        .prompt(&id, text("continue"), &Sink::default())
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("no pinned target"));
    assert_eq!(provider.creates.load(Ordering::SeqCst), 0);
    assert_eq!(provider.followups.load(Ordering::SeqCst), 0);
}

mod metadata_test;
