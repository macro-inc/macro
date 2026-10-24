use super::*;
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn marks_only_messages_of_the_link(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000801")?;
    let other_link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000802")?;
    let first = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;
    let second = Uuid::parse_str("00000000-0000-0000-0000-000000008502")?;
    let write_id = Uuid::parse_str("00000000-0000-0000-0000-00000000aa01")?;

    mark_pending_label_writes(&pool, link_id, &[first], "INBOX", write_id).await?;
    mark_pending_label_writes(&pool, other_link_id, &[second], "INBOX", write_id).await?;

    assert_eq!(pending_provider_label_ids(&pool, first).await?, ["INBOX"]);
    assert!(pending_provider_label_ids(&pool, second).await?.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn an_older_write_does_not_clear_a_newer_change(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000801")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;
    let archive = Uuid::parse_str("00000000-0000-0000-0000-00000000aa01")?;
    let unarchive = Uuid::parse_str("00000000-0000-0000-0000-00000000aa02")?;

    mark_pending_label_writes(&pool, link_id, &[message_id], "INBOX", archive).await?;
    mark_pending_label_writes(&pool, link_id, &[message_id], "INBOX", unarchive).await?;
    clear_pending_label_writes(&pool, &[message_id], archive).await?;
    assert_eq!(
        pending_provider_label_ids(&pool, message_id).await?,
        ["INBOX"]
    );

    clear_pending_label_writes(&pool, &[message_id], unarchive).await?;
    assert!(
        pending_provider_label_ids(&pool, message_id)
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn expired_changes_no_longer_apply(pool: Pool<Postgres>) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000801")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;
    let write_id = Uuid::parse_str("00000000-0000-0000-0000-00000000aa01")?;

    mark_pending_label_writes(&pool, link_id, &[message_id], "TRASH", write_id).await?;
    mark_pending_label_writes(&pool, link_id, &[message_id], "UNREAD", write_id).await?;
    sqlx::query!(
        "UPDATE email_gmail_pending_label_writes SET expires_at = now() - interval '1 second' WHERE provider_label_id = 'TRASH'"
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        pending_provider_label_ids(&pool, message_id).await?,
        ["UNREAD"]
    );
    Ok(())
}
