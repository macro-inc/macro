use super::super::*;
use macro_event_broker::{EventBrokerError, MacroEvent};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::{db, service};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub(super) const LINK: Uuid = Uuid::from_u128(1);
pub(super) const MESSAGE: Uuid = Uuid::from_u128(2);
pub(super) const THREAD: Uuid = Uuid::from_u128(3);

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Call {
    Link,
    Message,
    Labels,
    Pending,
    Provider,
    Begin(&'static str),
    LockedMessage,
    Recipients,
    Sender,
    Delete,
    Cleanup(Vec<String>),
    Add(Vec<String>),
    Remove(Vec<String>),
    SetRead(bool),
    ThreadUpdate,
    Commit,
    Rollback,
    Thread,
    Enqueue(bool, serde_json::Value),
    Refresh(bool),
    Event(serde_json::Value),
    Legacy(&'static str),
}

pub(super) struct State {
    pub calls: Vec<Call>,
    pub failures: Vec<(&'static str, usize)>,
    counts: HashMap<&'static str, usize>,
    pub link: Option<Link>,
    pub message: Option<service::message::SimpleMessage>,
    pub labels: Vec<db::label::Label>,
    pub pending: VecDeque<Vec<String>>,
    pub provider: Result<Option<Vec<String>>, email_api_client::domain::models::EmailApiError>,
    pub sender: Option<db::contact::Contact>,
    pub recipients: Vec<(db::contact::Contact, db::address::EmailRecipientType)>,
    pub deletion: MessageDeletion,
    pub thread: Option<service::thread::Thread>,
}

#[derive(Clone)]
pub(super) struct Fake(pub Arc<Mutex<State>>);

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct Failure(&'static str);

impl ConnectionSourceError for Failure {
    fn into_original(self) -> anyhow::Error {
        anyhow::anyhow!(self.0)
    }
}

impl Fake {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(State {
            calls: vec![],
            failures: vec![],
            counts: HashMap::new(),
            link: Some(link()),
            message: Some(message()),
            labels: vec![label("INBOX")],
            pending: VecDeque::new(),
            provider: Ok(Some(vec!["INBOX".into(), "UNREAD".into()])),
            sender: Some(contact(Some("sender@example.com"))),
            recipients: vec![(
                contact(Some("recipient@example.com")),
                db::address::EmailRecipientType::To,
            )],
            deletion: MessageDeletion::Deleted {
                deleted_thread: None,
            },
            thread: None,
        })))
    }

    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().calls.clone()
    }

    pub fn step(&self, name: &'static str, call: Call) -> Result<(), Failure> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(call);
        let count = state.counts.entry(name).or_default();
        *count += 1;
        let count = *count;
        if state.failures.contains(&(name, count)) {
            Err(Failure(name))
        } else {
            Ok(())
        }
    }
}

pub(super) fn make_service(
    retry_worker: bool,
) -> (InboxSyncService<Fake, Fake, Fake, Fake, Fake>, Fake) {
    let fake = Fake::new();
    (
        InboxSyncService {
            links: fake.clone(),
            repository: fake.clone(),
            gmail: fake.clone(),
            queue: fake.clone(),
            effects: fake.clone(),
            retry_worker,
        },
        fake,
    )
}

pub(super) fn input(operation: InboxSyncOperation) -> InboxSyncPubsubMessage {
    InboxSyncPubsubMessage {
        link_id: LINK,
        operation,
    }
}

pub(super) fn link() -> Link {
    Link {
        id: LINK,
        macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        fusionauth_user_id: "fixture-owner".into(),
        email_address: EmailStr::try_from("Owner@example.com".to_string()).unwrap(),
        provider: service::link::UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

pub(super) fn message() -> service::message::SimpleMessage {
    service::message::SimpleMessage {
        db_id: MESSAGE,
        provider_id: Some("message-1".into()),
        thread_db_id: THREAD,
        provider_thread_id: Some("thread-1".into()),
        replying_to_id: None,
        global_id: "global-1".into(),
        link_id: LINK,
        subject: Some("Subject".into()),
        snippet: None,
        from_contact_id: None,
        provider_history_id: None,
        internal_date_ts: None,
        sent_at: None,
        size_estimate: None,
        is_read: true,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        has_attachments: false,
        headers_json: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

pub(super) fn contact(email: Option<&str>) -> db::contact::Contact {
    db::contact::Contact {
        id: Uuid::from_u128(4),
        link_id: LINK,
        name: None,
        email_address: email.map(str::to_owned),
        original_photo_url: None,
        sfs_photo_url: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

pub(super) fn label(id: &str) -> db::label::Label {
    db::label::Label {
        id: Uuid::from_u128(5),
        link_id: LINK,
        provider_label_id: id.into(),
        name: id.into(),
        message_list_visibility: db::label::MessageListVisibility::Show,
        label_list_visibility: db::label::LabelListVisibility::LabelShow,
        type_: db::label::LabelType::System,
        created_at: Default::default(),
    }
}

impl GmailOpsLinks for Fake {
    type Err = Failure;
    async fn link(&self, id: Uuid) -> Result<Option<Link>, Failure> {
        assert_eq!(id, LINK);
        self.step("link", Call::Link)?;
        Ok(self.0.lock().unwrap().link.clone())
    }
}

impl InboxSyncRepository for Fake {
    type Err = Failure;
    type Delete = Self;
    type Labels = Self;
    async fn begin_delete(&self) -> Result<Self, Failure> {
        self.step("begin_delete", Call::Begin("delete"))?;
        Ok(self.clone())
    }
    async fn begin_labels(&self) -> Result<Self, Failure> {
        self.step("begin_labels", Call::Begin("labels"))?;
        Ok(self.clone())
    }
    async fn message(
        &self,
        link: Uuid,
        id: &str,
    ) -> Result<Option<service::message::SimpleMessage>, Failure> {
        assert_eq!((link, id), (LINK, "message-1"));
        self.step("message", Call::Message)?;
        Ok(self.0.lock().unwrap().message.clone())
    }
    async fn labels(&self, id: Uuid) -> Result<Vec<db::label::Label>, Failure> {
        assert_eq!(id, MESSAGE);
        self.step("labels", Call::Labels)?;
        Ok(self.0.lock().unwrap().labels.clone())
    }
    async fn pending_labels(&self, id: Uuid) -> Result<Vec<String>, Failure> {
        assert_eq!(id, MESSAGE);
        self.step("pending", Call::Pending)?;
        Ok(self
            .0
            .lock()
            .unwrap()
            .pending
            .pop_front()
            .unwrap_or_default())
    }
    async fn thread(
        &self,
        link: Uuid,
        thread: Uuid,
    ) -> Result<Option<service::thread::Thread>, Failure> {
        assert_eq!((link, thread), (LINK, THREAD));
        self.step("thread", Call::Thread)?;
        Ok(self.0.lock().unwrap().thread.clone())
    }
}

impl InboxSyncTransaction for Fake {
    type Err = Failure;
    async fn complete<T: Send>(
        self,
        result: Result<T, ProcessingError>,
    ) -> Result<T, ProcessingError> {
        let commit = result.is_ok();
        self.step(
            if commit { "commit" } else { "rollback" },
            if commit { Call::Commit } else { Call::Rollback },
        )
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.into_original(),
            })
        })?;
        result
    }
}

impl InboxSyncDeleteTransaction for Fake {
    async fn message_for_update(
        &mut self,
        link: Uuid,
        id: &str,
    ) -> Result<Option<service::message::SimpleMessage>, Failure> {
        assert_eq!((link, id), (LINK, "message-1"));
        self.step("locked_message", Call::LockedMessage)?;
        Ok(self.0.lock().unwrap().message.clone())
    }
    async fn recipients(
        &mut self,
        id: Uuid,
    ) -> Result<Vec<(db::contact::Contact, db::address::EmailRecipientType)>, Failure> {
        assert_eq!(id, MESSAGE);
        self.step("recipients", Call::Recipients)?;
        Ok(self.0.lock().unwrap().recipients.clone())
    }
    async fn sender(&mut self, id: Uuid) -> Result<Option<db::contact::Contact>, Failure> {
        assert_eq!(id, MESSAGE);
        self.step("sender", Call::Sender)?;
        Ok(self.0.lock().unwrap().sender.clone())
    }
    async fn delete(
        &mut self,
        message: &service::message::SimpleMessage,
    ) -> Result<MessageDeletion, Failure> {
        assert_eq!(message.db_id, MESSAGE);
        self.step("delete", Call::Delete)?;
        Ok(self.0.lock().unwrap().deletion)
    }
    async fn cleanup_contacts(
        &mut self,
        link: Uuid,
        emails: Vec<String>,
    ) -> Result<(), ProcessingError> {
        assert_eq!(link, LINK);
        self.step("cleanup", Call::Cleanup(emails)).map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.into_original(),
            })
        })
    }
}

impl InboxSyncLabelTransaction for Fake {
    async fn add_labels(&mut self, link: Uuid, id: Uuid, labels: &[String]) -> Result<(), Failure> {
        assert_eq!((link, id), (LINK, MESSAGE));
        self.step("add", Call::Add(labels.to_vec()))
    }
    async fn remove_labels(
        &mut self,
        link: Uuid,
        id: Uuid,
        labels: &[String],
    ) -> Result<(), Failure> {
        assert_eq!((link, id), (LINK, MESSAGE));
        self.step("remove", Call::Remove(labels.to_vec()))
    }
    async fn set_read(&mut self, link: Uuid, id: Uuid, read: bool) -> Result<(), Failure> {
        assert_eq!((link, id), (LINK, MESSAGE));
        self.step("set_read", Call::SetRead(read))
    }
    async fn update_thread(&mut self, link: Uuid, thread: Uuid) -> Result<(), Failure> {
        assert_eq!((link, thread), (LINK, THREAD));
        self.step("update_thread", Call::ThreadUpdate)
    }
}

impl InboxSyncGmail for Fake {
    fn message_labels<'a>(
        &'a self,
        link: Uuid,
        id: &'a str,
    ) -> futures::future::BoxFuture<
        'a,
        Result<Option<Vec<String>>, email_api_client::domain::models::EmailApiError>,
    > {
        assert_eq!((link, id), (LINK, "message-1"));
        Box::pin(async move {
            self.step("provider", Call::Provider).unwrap();
            self.0.lock().unwrap().provider.clone()
        })
    }
}

impl InboxSyncQueue for Fake {
    type Err = Failure;
    async fn enqueue(&self, message: InboxSyncPubsubMessage) -> Result<(), Failure> {
        self.step(
            "enqueue",
            Call::Enqueue(false, serde_json::to_value(message).unwrap()),
        )
    }
    async fn enqueue_retry(&self, message: InboxSyncPubsubMessage) -> Result<(), Failure> {
        self.step(
            "enqueue_retry",
            Call::Enqueue(true, serde_json::to_value(message).unwrap()),
        )
    }
}

impl MacroEventBroker for Fake {
    fn send_event<T: MacroEvent + ?Sized>(
        &self,
        event: &T,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.step(
            "event",
            Call::Event(serde_json::to_value(event.event()).unwrap()),
        )
        .map_err(|e| EventBrokerError::Publish(e.to_string()))?;
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

impl InboxSyncRefresher for Fake {
    async fn refresh(&self, owner: &str, event: InboxSyncRefresh) {
        assert_eq!(owner, "macro|owner@example.com");
        let deleted = match event {
            InboxSyncRefresh::DeleteMessage(link) => {
                assert_eq!(link, LINK);
                true
            }
            InboxSyncRefresh::UpdateLabels(link) => {
                assert_eq!(link, LINK);
                false
            }
        };
        self.step("refresh", Call::Refresh(deleted)).unwrap();
    }
}

impl LegacyInboxSync for Fake {
    fn gmail_message<'a>(
        &'a self,
        link: &'a Link,
        _: &'a models_email::gmail::inbox_sync::GmailMessagePayload,
    ) -> futures::future::BoxFuture<'a, Result<(), ProcessingError>> {
        assert_eq!(link.id, LINK);
        Box::pin(async {
            self.step("history", Call::Legacy("history")).map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::GmailApiFailed,
                    source: e.into_original(),
                })
            })
        })
    }
    fn upsert_message<'a>(
        &'a self,
        link: &'a Link,
        _: &'a models_email::gmail::inbox_sync::UpsertMessagePayload,
    ) -> futures::future::BoxFuture<'a, Result<(), ProcessingError>> {
        assert_eq!(link.id, LINK);
        Box::pin(async {
            self.step("upsert", Call::Legacy("upsert")).map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::GmailApiFailed,
                    source: e.into_original(),
                })
            })
        })
    }
}
