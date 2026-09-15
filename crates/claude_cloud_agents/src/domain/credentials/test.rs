use super::*;
use crate::domain::model::Secret;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Default)]
struct Repo {
    data: Mutex<BTreeMap<String, Credentials>>,
    fail: AtomicBool,
}
#[async_trait::async_trait]
impl GrantRepository for Repo {
    async fn get(&self, owner: &str) -> Result<Option<Credentials>> {
        Ok(self.data.lock().await.get(owner).cloned())
    }
    async fn put(&self, owner: &str, grant: &Credentials) -> Result<()> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(Error::Credentials);
        }
        self.data.lock().await.insert(owner.into(), grant.clone());
        Ok(())
    }
    async fn delete(&self, owner: &str) -> Result<()> {
        self.data.lock().await.remove(owner);
        Ok(())
    }
}
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
    repo.fail.store(true, Ordering::SeqCst);
    assert!(service.resolve("alice").await.is_err());
    assert!(service.resolve("alice").await.is_err());
    assert_eq!(refresh.0.load(Ordering::SeqCst), 1);
    repo.fail.store(false, Ordering::SeqCst);
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
