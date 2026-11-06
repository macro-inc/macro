use super::*;
use email_db_client::messages::scheduled::{
    delivery::{
        DeliveryClaim, begin_submission, claim_delivery, complete_delivery, pause_delivery,
        release_preparation,
    },
    get::{get_and_start_processing_scheduled_message, get_scheduled_message},
};

fn identity() -> (Uuid, Uuid) {
    (
        Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap(),
        Uuid::parse_str("ee000003-0000-0000-0000-000000000003").unwrap(),
    )
}

async fn claim(pool: &Pool<Postgres>) -> anyhow::Result<DeliveryClaim> {
    let (link, message) = identity();
    Ok(claim_delivery(pool, link, message, 300)
        .await?
        .expect("fixture has a due scheduled draft"))
}

async fn preserve_submission(pool: Pool<Postgres>, unconfirmed: bool) -> anyhow::Result<()> {
    let (link, message) = identity();
    let claim = claim(&pool).await?;
    assert!(begin_submission(&pool, &claim, 300).await?);
    if unconfirmed {
        pause_delivery(&pool, &claim, true, 300).await?;
    }
    let repo = EmailPgRepo::new(pool.clone());
    assert!(
        repo.delete_scheduled_messages_batch(&[message], link)
            .await?
            .is_empty()
    );
    assert!(get_scheduled_message(&pool, link, message).await?.is_some());
    let mut tx = pool.begin().await?;
    assert!(complete_delivery(&mut tx, &claim).await?);
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn trash_preserves_submitted_delivery(pool: Pool<Postgres>) -> anyhow::Result<()> {
    preserve_submission(pool, false).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn trash_preserves_unconfirmed_delivery(pool: Pool<Postgres>) -> anyhow::Result<()> {
    preserve_submission(pool, true).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn trash_revokes_preparation_before_submission(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (link, message) = identity();
    let claim = claim(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    assert_eq!(
        repo.delete_scheduled_messages_batch(&[message], link)
            .await?,
        vec![message]
    );
    assert!(!begin_submission(&pool, &claim, 300).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn trash_revokes_backed_off_preparation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (link, message) = identity();
    let claim = claim(&pool).await?;
    release_preparation(&pool, &claim, 300).await?;
    let repo = EmailPgRepo::new(pool.clone());
    assert_eq!(
        repo.delete_scheduled_messages_batch(&[message], link)
            .await?,
        vec![message]
    );
    assert!(!begin_submission(&pool, &claim, 300).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn trash_preserves_ambiguous_legacy_claim(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (link, message) = identity();
    assert!(
        get_and_start_processing_scheduled_message(&pool, link, message)
            .await?
            .is_some()
    );
    let repo = EmailPgRepo::new(pool.clone());
    assert!(
        repo.delete_scheduled_messages_batch(&[message], link)
            .await?
            .is_empty()
    );
    assert!(get_scheduled_message(&pool, link, message).await?.is_some());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn trash_cancels_definitively_failed_delivery(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (link, message) = identity();
    let claim = claim(&pool).await?;
    assert!(begin_submission(&pool, &claim, 300).await?);
    pause_delivery(&pool, &claim, false, 300).await?;
    let repo = EmailPgRepo::new(pool.clone());
    assert_eq!(
        repo.delete_scheduled_messages_batch(&[message], link)
            .await?,
        vec![message]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn trash_racing_submission_has_one_winner(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let (link, message) = identity();
    let claim = claim(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    let messages = [message];
    let (deleted, submitted) = tokio::join!(
        repo.delete_scheduled_messages_batch(&messages, link),
        begin_submission(&pool, &claim, 300)
    );
    let deleted = deleted?;
    assert_eq!(deleted.is_empty(), submitted?);
    assert_eq!(
        get_scheduled_message(&pool, link, message).await?.is_none(),
        !deleted.is_empty()
    );
    Ok(())
}
