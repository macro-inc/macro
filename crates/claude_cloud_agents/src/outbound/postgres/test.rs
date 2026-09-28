use super::*;
use crate::domain::model::{Credentials, Secret};
use cursor_api_key::cipher::KmsCiphertextsError;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

type CipherRecords = HashMap<Vec<u8>, (HashMap<String, String>, Vec<u8>)>;
#[derive(Clone, Default)]
struct FakeKms(Arc<Mutex<CipherRecords>>);
#[async_trait::async_trait]
impl KmsCiphertexts for FakeKms {
    async fn encrypt(
        &self,
        context: HashMap<String, String>,
        plain: &[u8],
    ) -> std::result::Result<(Vec<u8>, String), KmsCiphertextsError> {
        let ciphertext = uuid::Uuid::now_v7().as_bytes().to_vec();
        self.0
            .lock()
            .unwrap()
            .insert(ciphertext.clone(), (context, plain.to_vec()));
        Ok((ciphertext, "test-key".into()))
    }
    async fn decrypt(
        &self,
        key: &str,
        bytes: &[u8],
        context: HashMap<String, String>,
    ) -> std::result::Result<Zeroizing<Vec<u8>>, KmsCiphertextsError> {
        let records = self.0.lock().unwrap();
        let (expected, plain) = records.get(bytes).ok_or(KmsCiphertextsError)?;
        if key != "test-key" || expected != &context {
            return Err(KmsCiphertextsError);
        }
        Ok(Zeroizing::new(plain.clone()))
    }
}

async fn user(pool: &sqlx::PgPool, id: &str) {
    let uuid = uuid::Uuid::now_v7();
    let email = format!("{id}@example.com");
    sqlx::query!(r#"WITH u AS (INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2) RETURNING id) INSERT INTO "User" ("id", "email", "macro_user_id") SELECT $3,$2,u.id FROM u"#, uuid, email, id).execute(pool).await.unwrap();
}
fn grant() -> Credentials {
    Credentials {
        access_token: Secret::parse("test-access".into()).unwrap(),
        refresh_token: Some(Secret::parse("test-refresh".into()).unwrap()),
        expires_at: 4_000_000_000,
        organization_id: "00000000-0000-4000-8000-000000000001".into(),
        environment_id: "env_test".into(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn durable_encrypted_grants_are_owner_bound_replaceable_and_removable(pool: sqlx::PgPool) {
    user(&pool, "alice").await;
    user(&pool, "bob").await;
    let kms = FakeKms::default();
    let store = PgClaudeGrants::new(pool.clone(), kms.clone());
    store.put("alice", &grant()).await.unwrap();
    assert!(store.get("bob").await.unwrap().is_none());
    let ciphertext = sqlx::query_scalar!(
        "SELECT grant_ciphertext FROM claude_oauth_grants WHERE user_id = 'alice'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!ciphertext.windows(11).any(|w| w == b"test-access"));
    // New adapter instance, same durable DB: no process-local grant cache.
    let restarted = PgClaudeGrants::new(pool.clone(), kms);
    assert_eq!(
        restarted
            .get("alice")
            .await
            .unwrap()
            .unwrap()
            .access_token
            .expose(),
        "test-access"
    );
    let mut rotated = grant();
    rotated.refresh_token = Some(Secret::parse("rotated-refresh".into()).unwrap());
    restarted.put("alice", &rotated).await.unwrap();
    assert_eq!(
        store
            .get("alice")
            .await
            .unwrap()
            .unwrap()
            .refresh_token
            .unwrap()
            .expose(),
        "rotated-refresh"
    );
    sqlx::query!("INSERT INTO claude_oauth_grants (user_id, grant_ciphertext, kms_key_id, encryption_version) SELECT 'bob', grant_ciphertext, kms_key_id, encryption_version FROM claude_oauth_grants WHERE user_id = 'alice'").execute(&pool).await.unwrap();
    assert!(matches!(store.get("bob").await, Err(Error::Credentials)));
    sqlx::query!("DELETE FROM claude_oauth_grants WHERE user_id = $1", "bob")
        .execute(&pool)
        .await
        .unwrap();
    assert!(store.get("alice").await.unwrap().is_some());
    restarted.delete("alice").await.unwrap();
    assert!(store.get("alice").await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pending_consent_is_encrypted_durable_and_locked_across_replicas(pool: sqlx::PgPool) {
    user(&pool, "alice").await;
    let kms = FakeKms::default();
    let first = Arc::new(PgClaudeGrants::new(pool.clone(), kms.clone()));
    let second = Arc::new(PgClaudeGrants::new(pool.clone(), kms));
    let mut transaction = first.lock("alice").await.unwrap();
    transaction.state().attempt = Some(crate::domain::auth::Attempt {
        id: "attempt".into(),
        state: "state".into(),
        verifier: Some(Secret::parse("private-verifier".into()).unwrap()),
        started: 1,
    });
    let waiting = {
        let second = second.clone();
        tokio::spawn(async move { second.lock("alice").await.unwrap() })
    };
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());
    transaction.commit().await.unwrap();
    let mut resumed = waiting.await.unwrap();
    assert_eq!(
        resumed
            .state()
            .attempt
            .as_ref()
            .unwrap()
            .verifier
            .as_ref()
            .unwrap()
            .expose(),
        "private-verifier"
    );
    resumed.state().attempt.as_mut().unwrap().verifier = None;
    resumed.commit().await.unwrap();
    drop(first);
    let mut restarted = second.lock("alice").await.unwrap();
    assert!(
        restarted
            .state()
            .attempt
            .as_ref()
            .unwrap()
            .verifier
            .is_none()
    );
    // An uncommitted replacement must not resurrect the consumed verifier.
    restarted.state().attempt = None;
    drop(restarted);
    assert!(
        second
            .lock("alice")
            .await
            .unwrap()
            .state()
            .attempt
            .is_some()
    );
    let ciphertext = sqlx::query_scalar!(
        "SELECT grant_ciphertext FROM claude_oauth_grants WHERE user_id = 'alice'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !ciphertext
            .windows(16)
            .any(|bytes| bytes == b"private-verifier")
    );
    second.delete("alice").await.unwrap();
    assert!(
        second
            .lock("alice")
            .await
            .unwrap()
            .state()
            .attempt
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_legacy_grants_and_upgrades_on_write(pool: sqlx::PgPool) {
    user(&pool, "alice").await;
    let kms = FakeKms::default();
    let (ciphertext, key) = kms
        .encrypt(context("alice", 1), &serde_json::to_vec(&grant()).unwrap())
        .await
        .unwrap();
    sqlx::query!("INSERT INTO claude_oauth_grants (user_id, grant_ciphertext, kms_key_id, encryption_version) VALUES ($1, $2, $3, 1) ON CONFLICT (user_id) DO UPDATE SET grant_ciphertext = EXCLUDED.grant_ciphertext, kms_key_id = EXCLUDED.kms_key_id, encryption_version = 1, updated_at = now()", "alice", ciphertext, key).execute(&pool).await.unwrap();
    let repository = PgClaudeGrants::new(pool, kms);
    let mut transaction = repository.lock("alice").await.unwrap();
    assert_eq!(
        transaction
            .state()
            .grant
            .as_ref()
            .unwrap()
            .access_token
            .expose(),
        "test-access"
    );
    transaction.commit().await.unwrap();
    assert!(repository.get("alice").await.unwrap().is_some());
}
