use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::credentials::{GrantRepository, test_support::MemoryRepository};
use std::sync::Arc;

#[derive(Clone, Default)]
struct Store(Arc<MemoryRepository>);
impl ConnectionStore for Store {
    async fn lock(&self, owner: &str) -> Result<Box<dyn GrantTransaction>, Error> {
        self.0.lock(owner).await
    }
    async fn connected(&self, owner: &str) -> bool {
        self.0.get(owner).await.unwrap().is_some()
    }
    async fn save(&self, owner: &str, c: Credentials) -> Result<(), Error> {
        self.0.put(owner, &c).await
    }
    async fn remove(&self, owner: &str) -> Result<(), Error> {
        self.0.delete(owner).await
    }
}
#[derive(Default)]
struct Provider {
    calls: AtomicUsize,
    fail: bool,
    gate: Option<Arc<tokio::sync::Semaphore>>,
}
fn secret(s: &str) -> Secret {
    Secret::parse(s.to_owned()).unwrap()
}
impl OAuthProvider for Provider {
    fn authorization_url(&self, state: &str, _: &Secret) -> String {
        format!("https://claude.com/consent?state={state}")
    }
    async fn exchange(&self, _: Secret, _: &str, _: Secret) -> Result<Credentials, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(gate) = &self.gate {
            gate.acquire().await.unwrap().forget();
        }
        if self.fail {
            return Err(Error::Authorization);
        }
        Ok(Credentials {
            access_token: secret("access"),
            refresh_token: Some(secret("refresh")),
            expires_at: u64::MAX,
            organization_id: "org".into(),
            environment_id: "env_test".into(),
        })
    }
}
fn code(login: &Login) -> Secret {
    secret(&format!(
        "one-time-code#{}",
        login.authorization_url.split("state=").nth(1).unwrap()
    ))
}

#[tokio::test]
async fn owner_bound_single_use_and_disconnect() {
    let store = Store::default();
    let service = AuthService::new(Provider::default(), Some(store.clone()), true);
    let login = service.begin("macro|alice").await.unwrap();
    assert!(matches!(
        service
            .complete("macro|bob", &login.attempt_id, code(&login))
            .await,
        Err(AuthError::InvalidAttempt)
    ));
    assert_eq!(service.provider.calls.load(Ordering::SeqCst), 0);
    assert!(matches!(
        service
            .complete("macro|alice", &login.attempt_id, secret("code#wrong-state"))
            .await,
        Err(AuthError::InvalidCode)
    ));
    service
        .complete("macro|alice", &login.attempt_id, code(&login))
        .await
        .unwrap();
    assert!(service.status("macro|alice").await.connected);
    assert!(!service.status("macro|bob").await.connected);
    assert!(matches!(
        service
            .complete("macro|alice", &login.attempt_id, code(&login))
            .await,
        Err(AuthError::InvalidAttempt)
    ));
    service.disconnect("macro|bob").await.unwrap();
    assert!(service.status("macro|alice").await.connected);
    service.disconnect("macro|alice").await.unwrap();
    assert!(!service.status("macro|alice").await.connected);
}

#[tokio::test]
async fn expiry_replacement_and_rate_limit() {
    let service = AuthService::new(Provider::default(), Some(Store::default()), true);
    let old = service.begin("alice").await.unwrap();
    assert!(matches!(service.begin("alice").await, Err(AuthError::Busy)));
    let mut transaction = service.store.as_ref().unwrap().lock("alice").await.unwrap();
    transaction.state().attempt.as_mut().unwrap().started -= LOGIN_TTL.as_secs();
    transaction.commit().await.unwrap();
    assert!(matches!(
        service.complete("alice", &old.attempt_id, code(&old)).await,
        Err(AuthError::InvalidAttempt)
    ));
    let new = service.begin("alice").await.unwrap();
    assert_ne!(old.attempt_id, new.attempt_id);
    assert!(matches!(
        service.complete("alice", &old.attempt_id, code(&old)).await,
        Err(AuthError::InvalidAttempt)
    ));
    service
        .complete("alice", &new.attempt_id, code(&new))
        .await
        .unwrap();
}

#[tokio::test]
async fn failure_consumes_code_and_disabled_never_starts() {
    let disabled = AuthService::<_, Store>::new(Provider::default(), None, true);
    assert!(!disabled.status("alice").await.enabled);
    assert!(matches!(
        disabled.begin("alice").await,
        Err(AuthError::Disabled)
    ));
    let service = AuthService::new(
        Provider {
            fail: true,
            ..Default::default()
        },
        Some(Store::default()),
        true,
    );
    let login = service.begin("alice").await.unwrap();
    assert!(matches!(
        service
            .complete("alice", &login.attempt_id, code(&login))
            .await,
        Err(AuthError::Provider(_))
    ));
    assert!(!service.status("alice").await.connected);
    assert!(matches!(
        service
            .complete("alice", &login.attempt_id, code(&login))
            .await,
        Err(AuthError::InvalidAttempt)
    ));
    assert_eq!(service.provider.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn disconnect_during_exchange_cannot_reconnect() {
    let gate = Arc::new(tokio::sync::Semaphore::new(0));
    let service = Arc::new(AuthService::new(
        Provider {
            gate: Some(gate.clone()),
            ..Default::default()
        },
        Some(Store::default()),
        true,
    ));
    let login = service.begin("alice").await.unwrap();
    let running = {
        let service = service.clone();
        tokio::spawn(async move {
            service
                .complete("alice", &login.attempt_id, code(&login))
                .await
        })
    };
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.provider.calls.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    service.disconnect("alice").await.unwrap();
    gate.add_permits(1);
    assert!(matches!(
        running.await.unwrap(),
        Err(AuthError::InvalidAttempt)
    ));
    assert!(!service.status("alice").await.connected);
}

#[tokio::test]
async fn consent_survives_replica_changes_and_restart() {
    let store = Store::default();
    let first = AuthService::new(Provider::default(), Some(store.clone()), false);
    let login = first.begin("alice").await.unwrap();
    drop(first);
    let second = AuthService::new(Provider::default(), Some(store.clone()), false);
    second
        .complete("alice", &login.attempt_id, code(&login))
        .await
        .unwrap();
    let third = AuthService::new(Provider::default(), Some(store), false);
    assert!(third.status("alice").await.connected);
    assert!(matches!(
        third
            .complete("alice", &login.attempt_id, code(&login))
            .await,
        Err(AuthError::InvalidAttempt)
    ));
    third.disconnect("alice").await.unwrap();
    assert!(!second.status("alice").await.connected);
}
