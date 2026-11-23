use super::*;
use email::domain::mailbox::{MailboxSyncRepository, SyncRetry, live_pass::StreamKind};
use email::outbound::mailbox_pg::PgMailboxSync;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_inbox_health_wake_preserves_imap_provider_pacing(db: sqlx::PgPool) {
    let link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider, grant_generation
        )
        VALUES ($1, 'macro|health@example.com', 'health-owner', 'health@example.com', 'IMAP', 1)
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id)
        VALUES ($1, $2, 1, 'mail_folder', 'INBOX')
        "#,
        Uuid::now_v7(),
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let repo =
        PgMailboxSync::new(db.clone()).with_provider(email::domain::models::UserProvider::Imap);
    let lease = repo
        .claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    repo.release_stream(&lease, SyncRetry::Provider(3600))
        .await
        .unwrap();
    wake_bound_streams(&db, link, 1, 1).await.unwrap();
    assert!(
        repo.claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
            .await
            .unwrap()
            .into_lease()
            .is_none()
    );
    let paced = sqlx::query_scalar!(
        "SELECT next_run_at = provider_retry_at FROM email_sync_streams WHERE id = $1",
        lease.id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(paced, Some(true));
}
