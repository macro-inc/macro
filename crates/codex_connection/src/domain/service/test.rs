use super::*;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

const OWNER: &str = "macro|owner@example.com";
const OTHER: &str = "macro|other@example.com";
#[derive(Default)]
struct Repo(Mutex<HashMap<String, Arc<tokio::sync::Mutex<ConnectionState>>>>);
impl Repo {
    fn owner(&self, owner: &str) -> Arc<tokio::sync::Mutex<ConnectionState>> {
        self.0
            .lock()
            .unwrap()
            .entry(owner.into())
            .or_default()
            .clone()
    }
}
struct Tx {
    guard: tokio::sync::OwnedMutexGuard<ConnectionState>,
    state: ConnectionState,
}
#[async_trait]
impl ConnectionTransaction for Tx {
    fn state(&mut self) -> &mut ConnectionState {
        &mut self.state
    }
    async fn commit(mut self: Box<Self>) -> Result<(), ConnectionError> {
        *self.guard = std::mem::take(&mut self.state);
        Ok(())
    }
}
#[async_trait]
impl ConnectionRepository for Repo {
    async fn lock(&self, owner: &str) -> Result<Box<dyn ConnectionTransaction>, ConnectionError> {
        let guard = self.owner(owner).lock_owned().await;
        let state = serde_json::from_slice(&serde_json::to_vec(&*guard).unwrap()).unwrap();
        Ok(Box::new(Tx { guard, state }))
    }
}
#[derive(Default)]
struct Counts {
    polls: AtomicUsize,
    refresh: AtomicUsize,
    account_changed: bool,
}
struct Provider(Arc<Counts>);
fn credentials(account: &str, expiry: u64) -> Credentials {
    Credentials {
        version: 1,
        access_token: Secret::new("test-access".into()).unwrap(),
        refresh_token: Secret::new("test-refresh".into()).unwrap(),
        expires_at: expiry,
        account_id: account.into(),
    }
}
impl OAuth for Provider {
    async fn begin(&self) -> Result<DeviceLogin, rootcause::Report> {
        Ok(DeviceLogin {
            verification_url: "https://auth.openai.com/codex/device".into(),
            user_code: "TEST-CODE".into(),
            device_auth_id: Secret::new("test-device".into())?,
            interval: Duration::from_secs(5),
            timeout: Duration::from_secs(900),
        })
    }
    async fn poll(&self, _: &DeviceLogin) -> Result<LoginPoll, rootcause::Report> {
        self.0.polls.fetch_add(1, Ordering::SeqCst);
        Ok(LoginPoll::Complete(credentials("account-a", u64::MAX)))
    }
    async fn refresh(&self, _: &Credentials) -> Result<Credentials, rootcause::Report> {
        self.0.refresh.fetch_add(1, Ordering::SeqCst);
        tokio::task::yield_now().await;
        Ok(credentials(
            if self.0.account_changed {
                "account-b"
            } else {
                "account-a"
            },
            u64::MAX,
        ))
    }
    async fn environments(&self, _: &Credentials) -> Result<Vec<Environment>, rootcause::Report> {
        Ok(vec![Environment {
            repositories: vec![],
            id: "env-test".into(),
            label: Some("Test".into()),
        }])
    }
}
fn service() -> (ConnectionServiceImpl<Provider>, Arc<Repo>, Arc<Counts>) {
    let repo = Arc::new(Repo::default());
    let counts = Arc::new(Counts::default());
    (
        ConnectionServiceImpl::new(repo.clone(), Provider(counts.clone())),
        repo,
        counts,
    )
}
async fn ready(repo: &Repo, owner: &str) {
    let owner = repo.owner(owner);
    let mut state = owner.lock().await;
    state.attempt.as_mut().unwrap().next_poll_at = Utc::now() - chrono::Duration::seconds(1);
}
#[tokio::test]
async fn device_attempt_owner_binding_poll_throttle_and_atomic_connection() {
    let (service, repo, counts) = service();
    let login = service.start_login(OWNER).await.unwrap();
    assert!(matches!(
        service.poll_login(OTHER, login.attempt_id).await,
        Err(ConnectionError::NotFound)
    ));
    assert!(matches!(
        service.cancel_login(OTHER, login.attempt_id).await,
        Err(ConnectionError::NotFound)
    ));
    assert!(matches!(
        service.poll_login(OWNER, login.attempt_id).await.unwrap(),
        LoginStatus::Pending
    ));
    assert_eq!(counts.polls.load(Ordering::SeqCst), 0);
    ready(&repo, OWNER).await;
    assert!(matches!(
        service.poll_login(OWNER, login.attempt_id).await.unwrap(),
        LoginStatus::Connected
    ));
    assert!(service.status(OWNER).await.unwrap().connected);
    assert!(!service.status(OTHER).await.unwrap().connected);
    assert!(
        repo.owner(OWNER)
            .lock()
            .await
            .attempt
            .as_ref()
            .unwrap()
            .device
            .is_none()
    );
    assert!(matches!(
        service.start_login(OWNER).await,
        Err(ConnectionError::AlreadyConnected)
    ));
}
#[tokio::test]
async fn expired_and_cancelled_attempts_never_exchange_credentials() {
    let (service, repo, counts) = service();
    let login = service.start_login(OWNER).await.unwrap();
    repo.owner(OWNER)
        .lock()
        .await
        .attempt
        .as_mut()
        .unwrap()
        .expires_at = Utc::now() - chrono::Duration::seconds(1);
    assert!(matches!(
        service.poll_login(OWNER, login.attempt_id).await.unwrap(),
        LoginStatus::Expired
    ));
    let second = service.start_login(OWNER).await.unwrap();
    service
        .cancel_login(OWNER, second.attempt_id)
        .await
        .unwrap();
    assert!(matches!(
        service.poll_login(OWNER, second.attempt_id).await,
        Err(ConnectionError::NotFound)
    ));
    assert_eq!(counts.polls.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn configuration_requires_visible_environment_and_refresh_is_serialized() {
    let (service, repo, counts) = service();
    let login = service.start_login(OWNER).await.unwrap();
    ready(&repo, OWNER).await;
    service.poll_login(OWNER, login.attempt_id).await.unwrap();
    assert!(
        service
            .resolve(OWNER)
            .await
            .unwrap()
            .environment_id
            .is_none()
    );
    assert!(matches!(
        service.configure(OWNER, "invisible").await,
        Err(ConnectionError::InvalidInput)
    ));
    service.configure(OWNER, "env-test").await.unwrap();
    repo.owner(OWNER)
        .lock()
        .await
        .connection
        .as_mut()
        .unwrap()
        .credentials
        .expires_at = 1;
    let (first, second) = tokio::join!(service.resolve(OWNER), service.resolve(OWNER));
    assert_eq!(first.unwrap().connection_id, second.unwrap().connection_id);
    assert_eq!(counts.refresh.load(Ordering::SeqCst), 1);
    service.disconnect(OWNER).await.unwrap();
    assert!(matches!(
        service.resolve(OWNER).await,
        Err(ConnectionError::NotConnected)
    ));
}
#[tokio::test]
async fn refresh_cannot_rebind_provider_account() {
    let repo = Arc::new(Repo::default());
    repo.owner(OWNER).lock().await.connection = Some(StoredConnection {
        id: Uuid::now_v7(),
        credentials: credentials("account-a", 1),
        environment_id: Some("env-test".into()),
    });
    let service = ConnectionServiceImpl::new(
        repo.clone(),
        Provider(Arc::new(Counts {
            account_changed: true,
            ..Default::default()
        })),
    );
    assert!(matches!(
        service.resolve(OWNER).await,
        Err(ConnectionError::AccountChanged)
    ));
    assert_eq!(
        repo.owner(OWNER)
            .lock()
            .await
            .connection
            .as_ref()
            .unwrap()
            .credentials
            .account_id,
        "account-a"
    );
}

#[tokio::test]
async fn configuration_requires_a_nonempty_visible_environment() {
    let (service, repo, _) = service();
    let login = service.start_login(OWNER).await.unwrap();
    ready(&repo, OWNER).await;
    service.poll_login(OWNER, login.attempt_id).await.unwrap();
    assert!(
        service
            .status(OWNER)
            .await
            .unwrap()
            .environment_id
            .is_none()
    );
    for environment in ["", " ", "unknown", "bad/environment"] {
        assert!(matches!(
            service.configure(OWNER, environment).await,
            Err(ConnectionError::InvalidInput)
        ));
    }
    let status = service.configure(OWNER, "env-test").await.unwrap();
    assert_eq!(status.environment_id.as_deref(), Some("env-test"));
    assert_eq!(
        service
            .resolve(OWNER)
            .await
            .unwrap()
            .environment_id
            .unwrap()
            .as_str(),
        "env-test"
    );
    assert!(service.configure(OWNER, "").await.is_err());
    assert_eq!(
        service
            .status(OWNER)
            .await
            .unwrap()
            .environment_id
            .as_deref(),
        Some("env-test")
    );
}
