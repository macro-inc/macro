use super::*;
use email_db_client::messages::{
    delete::{delete_db_message, reconcile_deferred_deletion},
    scheduled::delivery,
};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn deletion_retains_delivery_and_reconciliation_after_submission(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    let file = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO email_attachments(id,message_id,provider_attachment_id,filename,mime_type,size_bytes) VALUES($1,$2,'approved-file','file.txt','text/plain',4)", file, message()).execute(&pool).await?;
    let mut approved = prepared();
    approved.snapshot.forwarded_attachment_ids = vec![file];
    repo.admit_send(&actor(), link(), attempt, approved).await?;
    sqlx::query!("UPDATE email_scheduled_messages SET send_time=NOW()-INTERVAL '1 minute' WHERE message_id=$1", message()).execute(&pool).await?;
    assert!(!delete_db_message(&pool, message()).await?);
    let claim = delivery::claim_delivery(&pool, link(), message(), 300)
        .await?
        .unwrap();
    assert!(!claim.requires_reconciliation);
    assert!(claim.prepared_content.is_some());
    assert!(delivery::begin_submission(&pool, &claim, 300).await?);
    assert!(!delete_db_message(&pool, message()).await?);
    delivery::pause_delivery(&pool, &claim, true, 0).await?;
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_none()
    );
    let recovery = delivery::claim_delivery(&pool, link(), message(), 300)
        .await?
        .unwrap();
    assert!(recovery.requires_reconciliation);
    assert_eq!(recovery.message_id_header, claim.message_id_header);
    assert!(recovery.prepared_content.is_some());
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM email_attachments WHERE id=$1", file)
            .fetch_one(&pool)
            .await?,
        Some(1)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn failed_send_keeps_recoverable_content_until_cancel(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_status='failed', processing=true WHERE message_id=$1",
        message()
    )
    .execute(&pool)
    .await?;
    assert!(!delete_db_message(&pool, message()).await?);
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_none()
    );
    assert!(
        sqlx::query_scalar!(
            "SELECT prepared_content IS NOT NULL FROM email_send_attempts WHERE attempt_id=$1",
            attempt.0
        )
        .fetch_one(&pool)
        .await?
        .unwrap()
    );
    repo.cancel_send(&actor(), link(), attempt).await?;
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_none()
    );
    let restored = repo.send_message_row(link(), message()).await?.unwrap();
    assert!(restored.is_draft);
    assert_eq!(restored.body_text.as_deref(), Some("Editable body"));
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM email_deferred_message_deletions")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn deferred_deletion_cannot_delete_a_resend_with_the_same_provider_identity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let first = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), first, prepared()).await?;
    sqlx::query!(
        "UPDATE email_messages SET provider_id='unchanged-provider-id' WHERE id=$1",
        message()
    )
    .execute(&pool)
    .await?;
    assert!(!delete_db_message(&pool, message()).await?);
    repo.cancel_send(&actor(), link(), first).await?;
    let second = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), second, prepared_generation(2))
        .await?;
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_none()
    );
    assert!(repo.send_message_row(link(), message()).await?.is_some());
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), second, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Accepted
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM email_deferred_message_deletions")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn terminal_deletion_applies_only_to_the_captured_provider_identity(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_messages SET provider_id='provider-draft' WHERE id=$1",
        message()
    )
    .execute(&pool)
    .await?;
    assert!(!delete_db_message(&pool, message()).await?);
    email_db_client::messages::update::mark_message_as_sent(
        &mut *pool.acquire().await?,
        "provider-sent",
        "provider-thread-1",
        link(),
        message(),
    )
    .await?;
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_none()
    );
    assert!(repo.send_message_row(link(), message()).await?.is_some());
    // A deletion for the confirmed sent identity is still applied normally.
    assert!(delete_db_message(&pool, message()).await?);
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), attempt, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Sent
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn confirmed_delivery_with_unchanged_provider_identity_finishes_deferred_deletion(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;
    sqlx::query!(
        "UPDATE email_messages SET provider_id='provider-message' WHERE id=$1",
        message()
    )
    .execute(&pool)
    .await?;
    assert!(!delete_db_message(&pool, message()).await?);
    email_db_client::messages::update::mark_message_as_sent(
        &mut *pool.acquire().await?,
        "provider-message",
        "provider-thread-1",
        link(),
        message(),
    )
    .await?;
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_some()
    );
    assert!(repo.send_message_row(link(), message()).await?.is_none());
    assert!(
        reconcile_deferred_deletion(&pool, link(), message())
            .await?
            .is_none()
    );
    assert_eq!(
        repo.read_send_attempt(&actor(), link(), attempt, None)
            .await?
            .unwrap()
            .status,
        SendAttemptStatus::Sent
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn explicit_inbox_removal_revokes_authority_without_blocking_the_parent_cascade(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    repo.admit_send(
        &actor(),
        link(),
        SendAttemptId(macro_uuid::generate_uuid_v7()),
        prepared(),
    )
    .await?;
    assert!(!delete_db_message(&pool, message()).await?);
    sqlx::query!("DELETE FROM email_links WHERE id=$1", link())
        .execute(&pool)
        .await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM email_send_attempts WHERE link_id=$1",
            link()
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM email_deferred_message_deletions")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn explicit_inbox_purge_removes_an_accepted_send_and_its_retained_deletion(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    repo.admit_send(
        &actor(),
        link(),
        SendAttemptId(macro_uuid::generate_uuid_v7()),
        prepared(),
    )
    .await?;
    assert!(!delete_db_message(&pool, message()).await?);
    let summary = email_db_client::links::delete::purge_link(
        &pool,
        link(),
        email_db_client::links::delete::PurgePacing::default(),
    )
    .await?;
    // The fixture has four messages in this inbox and one in a second inbox.
    assert_eq!(summary.messages, 4);
    assert!(summary.link_deleted);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM email_send_attempts WHERE link_id=$1",
            link()
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM email_deferred_message_deletions")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}
