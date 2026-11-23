use super::*;
use crate::domain::service::{
    Engine,
    test::{MemoryRepository, ProviderWorkControl, TestCipher, UncertainTransport},
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU32},
};
use tokio_util::sync::CancellationToken;

#[sqlx::test(migrations = false)]
async fn graceful_restart_releases_both_leases_before_their_expiry(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
        VALUES ($1, 'owner', 'IMAP')
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let health = serde_json::to_value(AccountState::default()).unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_accounts (link_id, user_id, sync_generation, grant_generation, credential_ciphertext, state)
        VALUES ($1, 'owner', 1, 1, decode('01', 'hex'), $2)
        "#,
        link,
        health,
    )
    .execute(&pool)
    .await
    .unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let repository = Arc::new(PgRepository::new(pool));
    let fake = Arc::new(MemoryRepository {
        revision: Default::default(),
        scoped_acquire_errors: Default::default(),
        state: std::sync::Mutex::new(AccountState::default()),
        saved_unknown: AtomicBool::new(false),
        command_leases: None,
        owner_available: AtomicBool::new(true),
        owner_claims: AtomicU32::new(0),
        owner_errors: AtomicU32::new(0),
        renewal: Default::default(),
        releases: AtomicU32::new(0),
        owner_gate: std::sync::Mutex::new(None),
        acquire_gate: None,
    });
    let (started, mut observed) = tokio::sync::mpsc::unbounded_channel();
    let transport = Arc::new(UncertainTransport {
        repository: fake,
        submissions: AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        sent_found: std::sync::Mutex::new(Default::default()),
        submission_deadline: std::sync::Mutex::new(None),
        submit_control: None,
        refusal: None,
        provider_work: Some(Arc::new(ProviderWorkControl {
            idle: None,
            failures: Default::default(),
            organization: None,
            source: None,
            started,
            // Hold the round in provider IO, with its real Postgres command
            // lease active, until cooperative shutdown cancels it.
            released: tokio::sync::Semaphore::new(0),
        })),
    });
    for _ in 0..2 {
        let engine = Engine::new(
            crate::domain::service::VerificationScopeKey::derive("synthetic-test-auth-key")
                .unwrap(),
            repository.clone(),
            Arc::new(TestCipher),
            transport.clone(),
            tokio_util::task::TaskTracker::new(),
            tokio_util::sync::CancellationToken::new(),
        );
        let cancellation = CancellationToken::new();
        let stop = cancellation.clone();
        let actor = tokio::spawn(async move { engine.run_account(binding, stop).await });
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(5), observed.recv())
                .await
                .expect("restart must enter provider work without waiting for a five-minute lease")
                .unwrap(),
            link,
        );
        assert!(matches!(
            repository.acquire(binding).await,
            Err(Error::AccountBusy)
        ));
        cancellation.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(5), actor)
            .await
            .expect("shutdown must drain command cleanup promptly")
            .unwrap()
            .unwrap();
        let command = repository.acquire(binding).await.unwrap();
        repository.release(&command).await.unwrap();
        let successor = Uuid::now_v7();
        assert!(repository.claim_owner(binding, successor).await.unwrap());
        repository.release_owner(binding, successor).await.unwrap();
    }
}
