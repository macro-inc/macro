use super::*;
use crate::domain::cloud::{CloudEventStream, CloudTasks, CreatedTask, TaskSnapshot, TurnSnapshot};
use crate::domain::{Credentials, DeviceLogin, Environment, LoginPoll, Secret};
use std::sync::atomic::AtomicUsize;

#[derive(Default, Clone)]
struct Journal(Arc<Mutex<HashMap<String, StoredSession>>>);
impl SessionStore for Journal {
    fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().insert(id.to_owned(), state.clone());
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
    cancels: AtomicUsize,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
    ambiguous: bool,
    paused: bool,
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
        }])
    }
}
fn snapshot(turn: &str, status: &str) -> TaskSnapshot {
    TaskSnapshot {
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
        Ok(snapshot("turn_external", "completed"))
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
        panic!("unexpected follow-up")
    }
    async fn cancel(&self, _: &Credentials, _: &CloudId) -> Result<(), rootcause::Report> {
        self.0.cancels.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    async fn turn(
        &self,
        _: &Credentials,
        _: &CloudId,
        _: &TurnId,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        Ok(snapshot("turn_new", "cancelled"))
    }
    async fn stream(
        &self,
        _: &Credentials,
        _: &CloudId,
        _: &TurnId,
    ) -> Result<CloudEventStream, rootcause::Report> {
        Ok(Box::pin(futures::stream::empty()))
    }
}
fn service(state: Arc<State>, journal: Journal) -> SessionService<Provider, Auth, Journal> {
    SessionService::new(
        Arc::new(Probe::new(Provider(state), Auth)),
        journal,
        CloudId::new("env_test".into()).unwrap(),
        "main".into(),
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
    let id = service.new_session().unwrap();
    let sink = Sink::default();
    assert!(service.prompt(&id, "hello".into(), &sink).await.is_err());
    assert!(journal.load(&id).unwrap().unwrap().uncertain_write);
    assert!(service.prompt(&id, "retry".into(), &sink).await.is_err());
    assert_eq!(state.creates.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn concurrent_prompt_is_rejected_and_cancel_during_create_reaches_remote_receipt() {
    let state = Arc::new(State {
        paused: true,
        ..Default::default()
    });
    let service = service(state.clone(), Journal::default());
    let id = service.new_session().unwrap();
    let sink = Sink::default();
    let prompt = service.prompt(&id, "hello".into(), &sink);
    tokio::pin!(prompt);
    tokio::select! {
        _ = &mut prompt => panic!("creation should pause"),
        _ = state.entered.notified() => {}
    }
    assert!(service.prompt(&id, "parallel".into(), &sink).await.is_err());
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
                environment: "env_test".into(),
                branch: "main".into(),
                task: Some("task_test".into()),
                turn: Some("turn_old".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let service = service(state.clone(), journal);
    let error = service
        .prompt(&id, "hello".into(), &Sink::default())
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("advanced outside"));
    assert_eq!(state.creates.load(Ordering::SeqCst), 0);
}

struct FailingReceiptJournal(Journal);
impl SessionStore for FailingReceiptJournal {
    fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        self.0.load(id)
    }
    fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        if state.task.is_some() {
            return Err(rootcause::report!("injected receipt disk failure"));
        }
        self.0.save(id, state)
    }
}
#[tokio::test]
async fn receipt_persistence_failure_keeps_session_uncertain_in_memory_and_on_disk() {
    let state = Arc::new(State::default());
    let journal = Journal::default();
    let service = SessionService::new(
        Arc::new(Probe::new(Provider(state.clone()), Auth)),
        FailingReceiptJournal(journal.clone()),
        CloudId::new("env_test".into()).unwrap(),
        "main".into(),
    );
    let id = service.new_session().unwrap();
    let sink = Sink::default();
    assert!(service.prompt(&id, "hello".into(), &sink).await.is_err());
    assert!(journal.load(&id).unwrap().unwrap().uncertain_write);
    assert!(service.prompt(&id, "retry".into(), &sink).await.is_err());
    assert_eq!(state.creates.load(Ordering::SeqCst), 1);
}
#[test]
fn loading_session_from_another_account_rejects_replay_before_emitting_content() {
    let journal = Journal::default();
    let id = uuid::Uuid::now_v7().to_string();
    journal
        .save(
            &id,
            &StoredSession {
                account_id: "another-account".into(),
                environment: "env_test".into(),
                branch: "main".into(),
                history: vec![CloudEvent {
                    id: "private-message".into(),
                    method: "user/message".into(),
                    params: serde_json::json!({"text":"private text"}),
                }],
                ..Default::default()
            },
        )
        .unwrap();
    let service = service(Arc::new(State::default()), journal);
    let sink = Sink::default();
    assert!(service.replay(&id, &sink).is_err());
    assert!(sink.0.lock().unwrap().is_empty());
}
