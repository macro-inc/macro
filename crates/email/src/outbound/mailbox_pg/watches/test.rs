use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sha2::{Digest, Sha256};

async fn setup(db: &PgPool) -> (PgMailboxSync, Uuid, WatchLease, Uuid) {
    let (repo, link) = super::super::test::fixture(db).await;
    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work(link_id) VALUES($1)",
        link
    )
    .execute(db)
    .await
    .unwrap();
    let lease = repo.claim_watch(Uuid::new_v4()).await.unwrap().unwrap();
    let id = Uuid::new_v4();
    let hash = Sha256::digest(b"secret");
    repo.reserve_watch(&lease, id, &hash, Utc::now() + chrono::Duration::days(3))
        .await
        .unwrap();
    (repo, link, lease, id)
}
fn notification(state: &str, subscription: &str, hint: WatchHint) -> WatchNotification {
    WatchNotification {
        subscription_id: subscription.into(),
        client_state: state.into(),
        hint,
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_a_matching_verifier_can_bind_an_unknown_create_and_wake_the_mailbox(db: PgPool) {
    let (repo, link, _, id) = setup(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at=now()+interval '1 hour' WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let ingress = MailboxWatchNotifications(repo.clone());
    ingress
        .receive(id, vec![notification("wrong", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT provider_id FROM email_provider_subscriptions WHERE id=$1",
        id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(row.provider_id.is_none());
    ingress
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT provider_id FROM email_provider_subscriptions WHERE id=$1",
        id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.provider_id.as_deref(), Some("sub"));
    assert!(repo.claim_stream(Uuid::new_v4()).await.unwrap().is_some());
    ingress
        .receive(
            id,
            vec![notification("secret", "different", WatchHint::Changed)],
        )
        .await
        .unwrap();
    assert_eq!(
        repo.notification_binding(id)
            .await
            .unwrap()
            .unwrap()
            .provider_id
            .unwrap()
            .as_str(),
        "sub"
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_during_a_delta_page_is_not_erased_by_its_checkpoint(db: PgPool) {
    let (repo, _, _, id) = setup(&db).await;
    let stream = repo.claim_stream(Uuid::new_v4()).await.unwrap().unwrap();
    MailboxWatchNotifications(repo.clone())
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    repo.commit_page(&stream, &super::super::test::page())
        .await
        .unwrap();
    assert!(
        repo.claim_stream(Uuid::new_v4()).await.unwrap().is_some(),
        "the authenticated wakeup must survive the page commit"
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lifecycle_event_during_renewal_survives_worker_release(db: PgPool) {
    let (repo, _, lease, id) = setup(&db).await;
    MailboxWatchNotifications(repo.clone())
        .receive(
            id,
            vec![notification("secret", "sub", WatchHint::Reauthorize)],
        )
        .await
        .unwrap();
    repo.release_watch(&lease, 43200).await.unwrap();
    assert!(repo.claim_watch(Uuid::new_v4()).await.unwrap().is_some());
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_rejects_old_notification_and_worker_but_keeps_attempt_for_remote_cleanup(
    db: PgPool,
) {
    let (repo, link, lease, id) = setup(&db).await;
    sqlx::query!(
        "UPDATE email_links SET sync_generation=sync_generation+1 WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.notification_binding(id).await.unwrap().is_none());
    assert!(matches!(
        repo.bind_watch(
            &lease,
            id,
            &MailboxSubscription {
                id: ProviderId::new("sub").unwrap(),
                expires_at: Utc::now() + chrono::Duration::days(2)
            }
        )
        .await,
        Err(MailboxError::Stale)
    ));
    MailboxWatchNotifications(repo.clone())
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    let rows = repo.watch_attempts(&lease).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].provider_id.is_none());
}
