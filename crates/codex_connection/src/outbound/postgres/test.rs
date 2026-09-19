use super::*;
use crate::domain::{LoginAttempt, LoginStatus};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::collections::HashMap;
use tokio::sync::Mutex;
use uuid::Uuid;

// Store opaque handles in PostgreSQL while retaining plaintext solely inside this fake.
#[derive(Default)]
struct Cipher(Mutex<HashMap<Vec<u8>, Vec<u8>>>);
#[async_trait]
impl StateCipher for Cipher {
    async fn encrypt(
        &self,
        _: &str,
        state: &ConnectionState,
    ) -> Result<EncryptedState, ConnectionError> {
        let handle = Uuid::now_v7().as_bytes().to_vec();
        self.0
            .lock()
            .await
            .insert(handle.clone(), serde_json::to_vec(state).unwrap());
        Ok(EncryptedState {
            version: 1,
            ciphertext: handle,
            encrypted_data_key: vec![1],
            nonce: vec![0; 12],
            kms_key_id: "test".into(),
        })
    }
    async fn decrypt(
        &self,
        _: &str,
        envelope: &EncryptedState,
    ) -> Result<ConnectionState, ConnectionError> {
        Ok(serde_json::from_slice(self.0.lock().await.get(&envelope.ciphertext).unwrap()).unwrap())
    }
}
async fn user(pool: &PgPool, id: &str) {
    let uuid = Uuid::now_v7();
    let email = format!("{uuid}@example.com");
    sqlx::query!(r#"WITH created AS (INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$3) RETURNING id) INSERT INTO "User" ("id", "email", "macro_user_id") SELECT $4,$2,id FROM created"#,uuid,email,format!("stripe_{uuid}"),id).execute(pool).await.unwrap();
}
fn attempt() -> LoginAttempt {
    LoginAttempt {
        id: Uuid::now_v7(),
        status: LoginStatus::Expired,
        expires_at: chrono::Utc::now(),
        next_poll_at: chrono::Utc::now(),
        interval_seconds: 5,
        device: None,
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_transactions_serialize_and_preserve_isolation(pool: PgPool) {
    user(&pool, "owner-a").await;
    user(&pool, "owner-b").await;
    let repository = PostgresRepository::new(pool.clone(), Arc::new(Cipher::default()));
    let mut first = repository.lock("owner-a").await.unwrap();
    first.state().attempt = Some(attempt());
    let second = repository.lock("owner-a");
    tokio::pin!(second);
    // A different owner remains independently usable while owner A holds its lock.
    let mut other = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        repository.lock("owner-b"),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(other.state().attempt.is_none());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), &mut second)
            .await
            .is_err()
    );
    let id = first.state().attempt.as_ref().unwrap().id;
    first.commit().await.unwrap();
    let mut second = tokio::time::timeout(std::time::Duration::from_secs(2), second)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second.state().attempt.as_ref().unwrap().id, id);
    second.state().attempt = None;
    second.commit().await.unwrap();
    let mut fetched = repository.lock("owner-a").await.unwrap();
    assert!(fetched.state().attempt.is_none());
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dropped_transaction_does_not_publish_state(pool: PgPool) {
    user(&pool, "owner-a").await;
    let repository = PostgresRepository::new(pool, Arc::new(Cipher::default()));
    let mut pending = repository.lock("owner-a").await.unwrap();
    pending.state().attempt = Some(attempt());
    drop(pending);
    let mut fetched = repository.lock("owner-a").await.unwrap();
    assert!(fetched.state().attempt.is_none());
}

struct RotatingProvider(Arc<std::sync::atomic::AtomicUsize>);
impl codex_cloud_agents::domain::OAuth for RotatingProvider {
    async fn begin(&self) -> Result<codex_cloud_agents::domain::DeviceLogin, rootcause::Report> {
        unreachable!()
    }
    async fn poll(
        &self,
        _: &codex_cloud_agents::domain::DeviceLogin,
    ) -> Result<codex_cloud_agents::domain::LoginPoll, rootcause::Report> {
        unreachable!()
    }
    async fn refresh(
        &self,
        _: &codex_cloud_agents::domain::Credentials,
    ) -> Result<codex_cloud_agents::domain::Credentials, rootcause::Report> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        tokio::task::yield_now().await;
        Ok(credentials(u64::MAX))
    }
    async fn environments(
        &self,
        _: &codex_cloud_agents::domain::Credentials,
    ) -> Result<Vec<codex_cloud_agents::domain::Environment>, rootcause::Report> {
        unreachable!()
    }
}
fn credentials(expires_at: u64) -> codex_cloud_agents::domain::Credentials {
    use codex_cloud_agents::domain::{Credentials, Secret};
    Credentials {
        version: 1,
        access_token: Secret::new("test-access".into()).unwrap(),
        refresh_token: Secret::new("test-refresh".into()).unwrap(),
        expires_at,
        account_id: "account-a".into(),
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn separate_service_replicas_rotate_one_owner_token_once(pool: PgPool) {
    use crate::domain::{ConnectionService, ConnectionServiceImpl, StoredConnection};
    let owner = "macro|owner@example.com";
    user(&pool, owner).await;
    let cipher = Arc::new(Cipher::default());
    let repository = Arc::new(PostgresRepository::new(pool.clone(), cipher.clone()));
    let mut initial = repository.lock(owner).await.unwrap();
    initial.state().connection = Some(StoredConnection {
        id: Uuid::now_v7(),
        credentials: credentials(1),
        environment_id: Some("env-test".into()),
    });
    initial.commit().await.unwrap();
    let rotations = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let first = ConnectionServiceImpl::new(repository, RotatingProvider(rotations.clone()));
    let second = ConnectionServiceImpl::new(
        Arc::new(PostgresRepository::new(pool, cipher)),
        RotatingProvider(rotations.clone()),
    );
    let (one, two) = tokio::join!(first.resolve(owner), second.resolve(owner));
    assert_eq!(one.unwrap().connection_id, two.unwrap().connection_id);
    assert_eq!(rotations.load(std::sync::atomic::Ordering::SeqCst), 1);
}
