use super::*;
use crate::domain::message_labels::gmail_ops::GmailOpsLinks;
use macro_event_broker::{EventBrokerError, MacroEvent};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use std::sync::{Arc, Mutex};

pub(super) const LINK: Uuid = Uuid::from_u128(1);

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Call {
    Link(Uuid),
    Probe(Uuid, bool),
    Primaries(String, Uuid),
    Notify {
        owner: String,
        email: String,
        recipients: Vec<String>,
    },
    Event(serde_json::Value),
    Prepare(Uuid, String),
    Delete(Uuid, String),
    DeletedUser(String),
}

pub(super) struct State {
    pub calls: Vec<Call>,
    pub link: Option<Link>,
    pub primaries: Vec<String>,
    pub ready: bool,
    pub fail: Option<&'static str>,
    pub stall_probe: bool,
    pub notified_at: Option<chrono::DateTime<chrono::Utc>>,
}
#[derive(Clone)]
pub(super) struct Fake(pub Arc<Mutex<State>>);

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct Failure(&'static str);
impl ConnectionSourceError for Failure {
    fn into_original(self) -> anyhow::Error {
        anyhow!(self.0)
    }
}

pub(super) fn service() -> (LinkManagerService<Fake, Fake, Fake, Fake, Fake, Fake>, Fake) {
    let fake = Fake(Arc::new(Mutex::new(State {
        calls: vec![],
        primaries: vec![],
        ready: true,
        fail: None,
        stall_probe: false,
        notified_at: None,
        link: Some(Link {
            id: LINK,
            macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
            fusionauth_user_id: "credential-owner".into(),
            email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
            provider: models_email::service::link::UserProvider::Gmail,
            is_sync_active: true,
            is_primary: true,
            needs_reauth: true,
            last_sync_error_at: Some("2026-01-02T03:04:05Z".parse().unwrap()),
            created_at: Default::default(),
            updated_at: Default::default(),
        }),
    })));
    (
        LinkManagerService {
            repository: fake.clone(),
            health: fake.clone(),
            lifecycle: fake.clone(),
            notifications: fake.clone(),
            broker: fake.clone(),
            deletion: fake.clone(),
        },
        fake,
    )
}

impl Fake {
    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().calls.clone()
    }
    fn step(&self, point: &'static str, call: Call) -> Result<(), Failure> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(call);
        if state.fail == Some(point) {
            Err(Failure(point))
        } else {
            Ok(())
        }
    }
}

impl GmailOpsLinks for Fake {
    type Err = Failure;
    async fn link(&self, link: Uuid) -> Result<Option<Link>, Self::Err> {
        self.step("link", Call::Link(link))?;
        Ok(self.0.lock().unwrap().link.clone())
    }
}
impl LinkManagerRepository for Fake {
    async fn primaries(&self, owner: &str, link: Uuid) -> Result<Vec<String>, Self::Err> {
        self.step("primaries", Call::Primaries(owner.into(), link))?;
        Ok(self.0.lock().unwrap().primaries.clone())
    }
}
impl LinkManagerHealth for Fake {
    async fn probe(&self, link: Uuid, refresh: bool) -> Result<(), MailboxError> {
        self.step("probe", Call::Probe(link, refresh))
            .map_err(|_| MailboxError::Persistence)?;
        let stall = self.0.lock().unwrap().stall_probe;
        if stall {
            std::future::pending().await
        } else {
            Ok(())
        }
    }
}
impl LinkManagerLifecycle for Fake {
    async fn prepare_delete(
        &self,
        link: Uuid,
        reason: DeletionReason,
    ) -> Result<bool, InboxLifecycleError> {
        self.step("prepare", Call::Prepare(link, reason.as_str().into()))
            .map_err(|_| InboxLifecycleError::Unavailable)?;
        Ok(self.0.lock().unwrap().ready)
    }
    async fn deleted_user(&self, owner: &str) -> Result<(), InboxLifecycleError> {
        self.step("deleted_user", Call::DeletedUser(owner.into()))
            .map_err(|_| InboxLifecycleError::Unavailable)
    }
}
impl LinkManagerNotifications for Fake {
    type Err = Failure;
    async fn send(&self, notification: ReauthNotification) -> Result<(), Self::Err> {
        let mut recipients: Vec<_> = notification
            .recipient_ids
            .iter()
            .map(ToString::to_string)
            .collect();
        recipients.sort();
        self.step(
            "notify",
            Call::Notify {
                owner: notification.owner.to_string(),
                email: notification.email_address,
                recipients,
            },
        )?;
        self.0.lock().unwrap().notified_at = Some(chrono::Utc::now());
        Ok(())
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
        .map_err(|error| EventBrokerError::Publish(error.to_string()))?;
        Ok(tokio::spawn(async { Ok(()) }))
    }
}
impl LinkDeletion for Fake {
    async fn delete(&self, link: &Link, reason: &DeletionReason) -> anyhow::Result<()> {
        self.step("delete", Call::Delete(link.id, reason.as_str().into()))
            .map_err(ConnectionSourceError::into_original)
    }
}
