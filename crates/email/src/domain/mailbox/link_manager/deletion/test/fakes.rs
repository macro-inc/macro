use super::*;
use crm::domain::model::CrmError;
use email_api_client::domain::models::EmailApiError;
use macro_event_broker::{EventBrokerError, MacroEvent};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::{cache::TokenCacheKey, link::UserProvider};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub(super) const LINK: Uuid = Uuid::from_u128(1);
pub(super) const TEAM: Uuid = Uuid::from_u128(2);
pub(super) const MINTED: Uuid = Uuid::from_u128(3);
pub(super) const OWNER: &str = "macro|owner@example.com";

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Call {
    Mark(Uuid),
    Cancel(Uuid),
    Stop(Uuid),
    Cache(String),
    Unlink(String, String, String),
    Team(String),
    CrmDelete(Uuid, Uuid),
    Purge(Uuid, u32, u32, u32, std::time::Duration),
    LinkRemoved(String, Uuid),
    Event(serde_json::Value),
    History(Uuid, String),
    Acquire,
    Promoted(String),
    Stub(String),
    Release,
}

pub(super) struct State {
    pub calls: Vec<Call>,
    pub errors: HashMap<&'static str, String>,
    pub fail: HashSet<&'static str>,
    pub team: Option<Uuid>,
    pub minted: Option<Uuid>,
    pub held: bool,
    pub stop_results: VecDeque<Result<(), EmailApiError>>,
    pub stop_times: Vec<tokio::time::Instant>,
}
#[derive(Clone)]
pub(super) struct Fake(pub Arc<Mutex<State>>);
pub(super) struct Connection(Fake);
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct Failure(pub &'static str);
pub(super) type Service = LinkDeletionService<Fake, Fake, Fake, Fake, Fake, Fake, Fake>;

pub(super) fn service() -> (Service, Fake) {
    let fake = Fake(Arc::new(Mutex::new(State {
        calls: vec![],
        fail: HashSet::new(),
        errors: HashMap::new(),
        team: Some(TEAM),
        minted: None,
        held: false,
        stop_results: VecDeque::new(),
        stop_times: vec![],
    })));
    (
        LinkDeletionService {
            repository: fake.clone(),
            gmail: fake.clone(),
            auth: fake.clone(),
            crm: fake.clone(),
            purge: fake.clone(),
            refresh: fake.clone(),
            broker: fake.clone(),
        },
        fake,
    )
}

pub(super) fn link() -> Link {
    Link {
        id: LINK,
        macro_id: MacroUserIdStr::try_from(OWNER.to_string()).unwrap(),
        fusionauth_user_id: "credential-owner".into(),
        email_address: EmailStr::try_from("owner@example.com".to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

pub(super) fn expected_calls(reason: &str, promoted: bool) -> Vec<Call> {
    let mut calls = vec![
        Call::Mark(LINK),
        Call::Cancel(LINK),
        Call::Stop(LINK),
        Call::Cache(
            TokenCacheKey::new("credential-owner", "owner@example.com", "GMAIL").to_redis_key(),
        ),
        Call::Unlink(
            "credential-owner".into(),
            "owner@example.com".into(),
            "google_gmail".into(),
        ),
        Call::Team(OWNER.into()),
        Call::CrmDelete(TEAM, LINK),
        Call::Purge(LINK, 500, 2000, 1000, std::time::Duration::from_secs(2)),
        Call::LinkRemoved(OWNER.into(), LINK),
        Call::Event(
            serde_json::json!({"schema_version": 1, "event_type":"email.link_disconnected", "metadata": {
                "link_id": LINK, "owner": OWNER, "email_address": "owner@example.com", "reason": reason,
            }}),
        ),
        Call::History(
            LINK,
            match reason {
                "unused" => "Unused",
                "inactive" => "Inactive",
                "manually_disabled" => "ManuallyDisabled",
                "user_deleted" => "UserDeleted",
                "access_revoked" => "AccessRevoked",
                _ => panic!("unexpected reason"),
            }
            .into(),
        ),
        Call::Acquire,
        Call::Promoted(OWNER.into()),
    ];
    if promoted {
        calls.push(Call::Stub(MINTED.to_string()));
    }
    calls.push(Call::Release);
    calls
}

impl Fake {
    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().calls.clone()
    }
    fn anyhow_step(&self, point: &'static str, call: Call) -> anyhow::Result<()> {
        self.step(point, call).map_err(|failure| {
            let error = anyhow::Error::new(failure);
            self.0
                .lock()
                .unwrap()
                .errors
                .insert(point, format!("{error:?}"));
            error
        })
    }
    fn step(&self, point: &'static str, call: Call) -> Result<(), Failure> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(call);
        if state.fail.contains(point) {
            Err(Failure(point))
        } else {
            Ok(())
        }
    }
}
impl LinkDeletionRepository for Fake {
    type AcquireError = Failure;
    type Connection = Connection;
    async fn mark_link_deleting(&self, link: Uuid) -> anyhow::Result<()> {
        self.anyhow_step("mark", Call::Mark(link))?;
        Ok(())
    }
    async fn cancel_active_jobs(&self, link: Uuid) -> anyhow::Result<usize> {
        self.anyhow_step("cancel", Call::Cancel(link))?;
        Ok(9)
    }
    async fn set_deleted_at(&self, link: Uuid, reason: &str) -> anyhow::Result<()> {
        self.anyhow_step("history", Call::History(link, reason.into()))?;
        Ok(())
    }
    async fn acquire(&self) -> Result<Connection, Failure> {
        self.step("acquire", Call::Acquire)?;
        self.0.lock().unwrap().held = true;
        Ok(Connection(self.clone()))
    }
}
impl PromotedMailboxCleanup for Connection {
    async fn delete_promoted_mailbox_user(&mut self, owner: &str) -> anyhow::Result<Option<Uuid>> {
        self.0
            .anyhow_step("promoted", Call::Promoted(owner.into()))?;
        Ok(self.0.0.lock().unwrap().minted)
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        let mut state = self.0.0.lock().unwrap();
        state.held = false;
        state.calls.push(Call::Release);
    }
}
impl LinkDeletionGmail for Fake {
    async fn stop_subscription_for_link(&self, link: &Link) -> Result<(), EmailApiError> {
        let mut state = self.0.lock().unwrap();
        state.calls.push(Call::Stop(link.id));
        state.stop_times.push(tokio::time::Instant::now());
        state.stop_results.pop_front().unwrap_or(Ok(()))
    }
    async fn delete_gmail_access_token(&self, key: &TokenCacheKey) -> anyhow::Result<()> {
        self.anyhow_step("cache", Call::Cache(key.to_redis_key()))?;
        Ok(())
    }
}
impl LinkDeletionAuth for Fake {
    type Err = Failure;
    async fn remove_link(&self, user: &str, email: &str, provider: &str) -> Result<(), Failure> {
        self.step(
            "unlink",
            Call::Unlink(user.into(), email.into(), provider.into()),
        )
    }
    async fn delete_inbox_grant_user(&self, user: &str) -> Result<(), Failure> {
        assert!(
            self.0.lock().unwrap().held,
            "connection must survive the identity request"
        );
        self.step("stub", Call::Stub(user.into()))
    }
}
impl LinkDeletionCrm for Fake {
    async fn get_team_id_for_user(&self, owner: &str) -> Result<Option<Uuid>, CrmError> {
        self.step("team", Call::Team(owner.into()))
            .map_err(|e| CrmError::InvalidRequest(e.to_string()))?;
        Ok(self.0.lock().unwrap().team)
    }
    async fn depopulate_link_in_team(&self, team: &Uuid, link: &Uuid) -> Result<(), CrmError> {
        self.step("crm_delete", Call::CrmDelete(*team, *link))
            .map_err(|e| CrmError::InvalidRequest(e.to_string()))
    }
}
impl LinkPurger for Fake {
    async fn purge_link(
        &self,
        link: Uuid,
        pacing: PurgePacing,
    ) -> anyhow::Result<crate::domain::mailbox::link_manager::purge::PurgeSummary> {
        self.anyhow_step(
            "purge",
            Call::Purge(
                link,
                pacing.messages.get(),
                pacing.threads.get(),
                pacing.contacts.get(),
                pacing.pause,
            ),
        )?;
        Ok(crate::domain::mailbox::link_manager::purge::PurgeSummary {
            messages: 12,
            threads: 4,
            contacts: 2,
            link_deleted: true,
        })
    }
}
impl LinkDeletionRefresh for Fake {
    async fn link_removed(&self, owner: &str, link_id: Uuid) {
        self.step("refresh", Call::LinkRemoved(owner.into(), link_id))
            .unwrap();
    }
}
impl MacroEventBroker for Fake {
    fn send_event<T: MacroEvent + ?Sized>(
        &self,
        event: &T,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let mut payload = serde_json::to_value(event.event()).unwrap();
        let event_id = payload.as_object_mut().unwrap().remove("event_id").unwrap();
        assert!(Uuid::parse_str(event_id.as_str().unwrap()).is_ok());
        self.step("event", Call::Event(payload))
            .map_err(|e| EventBrokerError::Publish(e.to_string()))?;
        Ok(tokio::spawn(async { Ok(()) }))
    }
}
