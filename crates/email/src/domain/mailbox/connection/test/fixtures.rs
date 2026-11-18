use super::*;
use crate::domain::mailbox::initialization::{InitializationError, InitializeMailbox};
use calendar_events::domain::models::{AppliedGoogleGrant, CalendarGrantIntent};
use email_api_client::domain::models::{AccessToken, EmailApiError};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::{Link, UserProvider};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub(super) const LINK: Uuid = Uuid::from_u128(1);
pub(super) const ATTEMPT: Uuid = Uuid::from_u128(2);
pub(super) const OWNER: Uuid = Uuid::from_u128(3);
pub(super) const JOB: Uuid = Uuid::from_u128(4);

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub(super) struct FakeError(pub &'static str);

impl ConnectionSourceError for FakeError {
    fn into_original(self) -> anyhow::Error {
        anyhow::anyhow!(self.0)
    }
}

pub(super) struct Data {
    pub calls: Vec<String>,
    pub attempt: GoogleConnectionAttempt,
    pub owner: Option<String>,
    pub by_email: Option<Link>,
    pub by_grant: Option<Link>,
    pub by_identity: Option<Link>,
    pub child_fusion: Option<Uuid>,
    pub login_email: String,
    pub recognizes: bool,
    pub fail: Option<&'static str>,
    pub unrecorded: bool,
    pub scopes: Vec<String>,
    pub update_failures: usize,
    pub watched: Option<Link>,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            calls: Vec::new(),
            attempt: GoogleConnectionAttempt {
                provider: "GMAIL".into(),
                owner: OWNER,
                email: Some("inbox@example.com".into()),
                requested_scopes: Vec::new(),
                granted_scopes: Vec::new(),
            },
            owner: None,
            by_email: None,
            by_grant: None,
            by_identity: None,
            child_fusion: Some(Uuid::from_u128(5)),
            login_email: "actor@example.com".into(),
            recognizes: false,
            fail: None,
            unrecorded: false,
            scopes: Vec::new(),
            update_failures: 0,
            watched: None,
        }
    }
}

#[derive(Clone)]
pub(super) struct Fake(pub Arc<Mutex<Data>>);
impl Fake {
    fn record(&self, call: &str) -> Result<(), FakeError> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(call.into());
        if data.fail == Some(call) {
            Err(FakeError("scripted failure"))
        } else {
            Ok(())
        }
    }
    fn connection_call(&self, call: &str) -> Result<(), ConnectionError> {
        self.record(call)
            .map_err(|error| ConnectionError::DatabaseError(error.into_original()))
    }
}

pub(super) fn request(attempt: bool) -> ConnectionRequest {
    ConnectionRequest {
        actor_macro_id: MacroUserIdStr::try_from("macro|actor@example.com".to_string()).unwrap(),
        actor_id: "macro|actor@example.com".into(),
        actor_fusion_id: OWNER.to_string(),
        attempt: attempt.then_some(ATTEMPT),
        force_share: false,
    }
}

pub(super) fn link(owner: &str) -> Link {
    Link {
        id: LINK,
        macro_id: MacroUserIdStr::try_from(owner.to_string()).unwrap(),
        fusionauth_user_id: OWNER.to_string(),
        email_address: EmailStr::try_from("inbox@example.com".to_string()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: false,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

pub(super) type Service = InboxConnectionService<Fake, Fake, Fake, Fake, Fake, Fake, Fake, Fake>;
pub(super) fn service(data: Data) -> (Service, Fake) {
    let fake = Fake(Arc::new(Mutex::new(data)));
    (
        InboxConnectionService {
            links: fake.clone(),
            transactions: fake.clone(),
            provider: fake.clone(),
            grants: fake.clone(),
            initializer: Arc::new(fake.clone()),
            backfill: fake.clone(),
            identity: fake.clone(),
            failure_observer: fake.clone(),
        },
        fake,
    )
}

impl ConnectionLinks for Fake {
    type Err = FakeError;
    async fn attempt(&self, _: Uuid) -> Result<GoogleConnectionAttempt, FakeError> {
        self.record("attempt")?;
        Ok(self.0.lock().unwrap().attempt.clone())
    }
    async fn account_for_email(&self, _: &str) -> Result<Option<String>, FakeError> {
        self.record("account")?;
        Ok(self.0.lock().unwrap().owner.clone())
    }
    async fn link_for_email(&self, _: &str) -> Result<Option<Link>, FakeError> {
        self.record("by_email")?;
        Ok(self.0.lock().unwrap().by_email.clone())
    }
    async fn link_for_identity(
        &self,
        _: &str,
        _: MacroUserIdStr<'static>,
    ) -> Result<Option<Uuid>, FakeError> {
        self.record("by_identity")?;
        Ok(self
            .0
            .lock()
            .unwrap()
            .by_identity
            .as_ref()
            .map(|link| link.id))
    }
    async fn link_for_grant(&self, _: &str, _: &str) -> Result<Option<Uuid>, FakeError> {
        self.record("by_grant")?;
        Ok(self.0.lock().unwrap().by_grant.as_ref().map(|link| link.id))
    }
    async fn account_fusion_id(&self, _: &str) -> Result<Option<Uuid>, FakeError> {
        self.record("child_fusion")?;
        Ok(self.0.lock().unwrap().child_fusion)
    }
    async fn organization(&self, _: &str) -> Result<Option<i32>, FakeError> {
        self.record("organization")?;
        Ok(Some(7))
    }
    async fn set_credential_owner(&self, _: Uuid, _: &str) -> Result<(), FakeError> {
        self.record("update_owner")?;
        let mut data = self.0.lock().unwrap();
        if data.update_failures > 0 {
            data.update_failures -= 1;
            Err(FakeError("update"))
        } else {
            Ok(())
        }
    }
    async fn cleanup_attempt(&self, _: Uuid, owner: &str) {
        assert_eq!(owner, OWNER.to_string());
        self.record("cleanup").unwrap();
    }
}

impl ConnectionTransactions for Fake {
    async fn delegate(&self, _: &str, _: &str, _: &str, _: Uuid) -> Result<(), ConnectionError> {
        self.connection_call("delegate")
    }
    async fn bootstrap(
        &self,
        _: &str,
        _: &str,
        child: &str,
        mut link: Link,
        cursor: &str,
    ) -> Result<Link, ConnectionError> {
        assert_eq!(link.macro_id.as_ref(), child);
        assert_eq!(cursor, "cursor");
        assert_eq!(link.fusionauth_user_id, Uuid::from_u128(5).to_string());
        self.connection_call("bootstrap")?;
        link.id = LINK;
        Ok(link)
    }
    async fn create(&self, _: &str, mut link: Link, cursor: &str) -> Result<Link, ConnectionError> {
        assert_eq!(self.0.lock().unwrap().watched.as_ref().unwrap().id, link.id);
        assert_eq!(cursor, "cursor");
        self.connection_call("create")?;
        link.id = LINK;
        Ok(link)
    }
    async fn promote(
        &self,
        _: &str,
        _: &str,
        _: &Link,
        organization: Option<i32>,
    ) -> Result<SharedInboxPromotion, ConnectionError> {
        assert_eq!(organization, Some(7));
        self.connection_call("promote")?;
        Ok(SharedInboxPromotion {
            link_id: LINK,
            mailbox_fusion_id: OWNER,
        })
    }
}

impl ConnectionProvider for Fake {
    type ScopeErr = FakeError;
    type RelocationErr = FakeError;
    async fn register_watch(&self, link: &Link) -> Result<String, EmailApiError> {
        self.record("watch")
            .map_err(|_| EmailApiError::AuthRequired)?;
        self.0.lock().unwrap().watched = Some(link.clone());
        Ok("cursor".into())
    }
    async fn fresh_token(&self, _: Uuid) -> Result<AccessToken, EmailApiError> {
        self.record("token")
            .map_err(|_| EmailApiError::AuthRequired)?;
        Ok(AccessToken::new("test-token"))
    }
    async fn token_scopes(&self, token: &AccessToken) -> Result<Vec<String>, FakeError> {
        assert_eq!(token.expose_secret(), "test-token");
        self.record("scopes")?;
        Ok(self.0.lock().unwrap().scopes.clone())
    }
    async fn relocate_grant(&self, _: &str, _: &str, _: &str) -> Result<String, FakeError> {
        self.record("relocate")?;
        Ok("shared-owner".into())
    }
}

impl ConnectionGrants for Fake {
    async fn unrecorded(&self, _: Uuid) -> bool {
        self.record("unrecorded").unwrap();
        self.0.lock().unwrap().unrecorded
    }
    async fn apply(
        &self,
        _: Uuid,
        scopes: &[String],
        intent: CalendarGrantIntent,
    ) -> Result<AppliedGoogleGrant, ConnectionError> {
        let mut data = self.0.lock().unwrap();
        data.calls.push(format!(
            "apply:{}:{}",
            matches!(intent, CalendarGrantIntent::CalendarRequested),
            scopes.join(",")
        ));
        if data.fail == Some("apply") {
            return Err(ConnectionError::DatabaseError(anyhow::anyhow!(
                "apply failed"
            )));
        }
        Ok(AppliedGoogleGrant {
            grant_version: 1,
            changed: true,
            jobs: Vec::new(),
        })
    }
    async fn consume(&self, _: Uuid) -> Result<(), ConnectionError> {
        self.connection_call("consume")
    }
    async fn clear_reauth(&self, _: Uuid) {
        self.record("clear_reauth").unwrap();
    }
}

impl ConnectionInitializer for Fake {
    async fn recognizes(&self, _: &InitializeMailbox) -> Result<bool, InitializationError> {
        self.record("recognizes")
            .map_err(|_| InitializationError::Unavailable)?;
        Ok(self.0.lock().unwrap().recognizes)
    }
    async fn initialize(&self, _: InitializeMailbox) -> Result<Uuid, InitializationError> {
        self.record("initialize")
            .map_err(|_| InitializationError::InvalidAttempt)?;
        Ok(LINK)
    }
}

impl ConnectionBackfill for Fake {
    async fn start(&self, _: &Link) -> Result<Uuid, ConnectionError> {
        self.record("backfill")
            .map_err(|_| ConnectionError::EnqueueError)?;
        Ok(JOB)
    }
}
impl ConnectionIdentity for Fake {
    fn login_email(&self, _: &str) -> Result<String, ConnectionError> {
        self.record("login_email")
            .map_err(|_| ConnectionError::LoginEmailUnavailable)?;
        Ok(self.0.lock().unwrap().login_email.clone())
    }
}
impl ConnectionFailureObserver for Fake {
    fn observe_failure(&self, _: &ConnectionRequest, _: &ConnectionError) {
        self.record("failure").unwrap();
    }
}
