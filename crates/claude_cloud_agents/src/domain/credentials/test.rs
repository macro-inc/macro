use super::test_support::MemoryRepository as Repo;
use super::*;
use crate::domain::model::Secret;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Default)]
struct Refresh(AtomicUsize);
#[async_trait::async_trait]
impl RefreshGrant for Refresh {
    async fn refresh(&self, grant: &Credentials) -> Result<Credentials> {
        self.0.fetch_add(1, Ordering::SeqCst);
        let mut updated = grant.clone();
        updated.expires_at = 4_000_000_000;
        updated.refresh_token = Some(Secret::parse("rotated".into()).unwrap());
        Ok(updated)
    }
}
#[tokio::test]
async fn refresh_rotation_retries_persistence_without_reusing_old_token_and_disconnect_wins() {
    let repo = Arc::new(Repo::default());
    let refresh = Arc::new(Refresh::default());
    let service = AccountCredentials::new(repo.clone(), refresh.clone());
    service
        .save(
            "alice",
            Credentials {
                access_token: Secret::parse("access".into()).unwrap(),
                refresh_token: Some(Secret::parse("old".into()).unwrap()),
                expires_at: 0,
                organization_id: "org".into(),
                environment_id: "env_test".into(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        service.resolve("bob").await,
        Err(Error::NotConnected)
    ));
    repo.fail_commit.store(2, Ordering::SeqCst);
    assert!(service.resolve("alice").await.is_err());
    repo.fail_commit.store(1, Ordering::SeqCst);
    assert!(service.resolve("alice").await.is_err());
    assert_eq!(refresh.0.load(Ordering::SeqCst), 1);
    repo.fail_commit.store(0, Ordering::SeqCst);
    assert_eq!(
        service
            .resolve("alice")
            .await
            .unwrap()
            .refresh_token
            .unwrap()
            .expose(),
        "rotated"
    );
    service.remove("alice").await.unwrap();
    assert!(matches!(
        service.resolve("alice").await,
        Err(Error::NotConnected)
    ));
    assert_eq!(refresh.0.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn another_replica_cannot_reuse_refresh_or_resurrect_a_disconnected_grant() {
    let repo = Arc::new(Repo::default());
    let refresh = Arc::new(Refresh::default());
    let first = AccountCredentials::new(repo.clone(), refresh.clone());
    let second = AccountCredentials::new(repo.clone(), refresh.clone());
    first
        .save(
            "alice",
            Credentials {
                access_token: Secret::parse("access".into()).unwrap(),
                refresh_token: Some(Secret::parse("old".into()).unwrap()),
                expires_at: 0,
                organization_id: "org".into(),
                environment_id: "env_test".into(),
            },
        )
        .await
        .unwrap();
    repo.fail_commit.store(2, Ordering::SeqCst);
    assert!(first.resolve("alice").await.is_err());
    assert!(matches!(
        second.resolve("alice").await,
        Err(Error::Authorization)
    ));
    assert_eq!(refresh.0.load(Ordering::SeqCst), 1);
    second.remove("alice").await.unwrap();
    assert!(matches!(
        first.resolve("alice").await,
        Err(Error::NotConnected)
    ));
    assert!(!second.contains("alice").await);
    assert_eq!(refresh.0.load(Ordering::SeqCst), 1);
}
