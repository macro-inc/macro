use super::*;
use crate::domain::service::{
    Engine,
    test::{
        RecordingNotifier, TestCipher,
        sync_cost::{SnapshotTransport, inbox},
    },
};
use std::sync::Arc;

#[sqlx::test(migrations = false)]
async fn unchanged_ten_thousand_message_sync_preserves_the_committed_revision(pool: PgPool) {
    schema(&pool).await;
    let binding = Binding {
        link_id: Uuid::now_v7(),
        sync_generation: 1,
        grant_generation: 1,
    };
    sqlx::query!(
        "INSERT INTO email_links(id,macro_id,provider) VALUES($1,'owner','IMAP')",
        binding.link_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO imap_accounts(link_id,user_id,sync_generation,grant_generation,credential_ciphertext,state) VALUES($1,'owner',1,1,decode('01','hex'),$2)", binding.link_id, serde_json::to_value(AccountState::default()).unwrap())
        .execute(&pool).await.unwrap();
    let repository = Arc::new(PgRepository::new(pool));
    let notifier = Arc::new(RecordingNotifier::default());
    let engine = Engine::new(
        repository.clone(),
        Arc::new(TestCipher),
        Arc::new(SnapshotTransport(std::sync::Mutex::new(
            vec![inbox(10_000, 10_001), inbox(10_000, 10_001)].into(),
        ))),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    )
    .with_notifier(notifier.clone());
    engine.execute(binding, Operation::Sync).await.unwrap();
    let before = repository
        .acquire_scoped(binding, StateSelection::Sync)
        .await
        .unwrap();
    assert_eq!(before.state.messages.len(), 10_000);
    repository.release(&before).await.unwrap();
    engine.execute(binding, Operation::Sync).await.unwrap();
    let after = repository
        .acquire_scoped(binding, StateSelection::Sync)
        .await
        .unwrap();
    assert_eq!(after.revision, before.revision);
    assert_eq!(after.state.messages.len(), 10_000);
    repository.release(&after).await.unwrap();
    assert_eq!(notifier.0.lock().unwrap().len(), 1);
}
