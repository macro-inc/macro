use super::*;
use crate::domain::models::{LabelListVisibility, LabelType, MessageListVisibility};

// ── get_label_by_id ─────────────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_get_label_by_id_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let label_id = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;

    let label = repo.get_label_by_id(label_id, link_id).await?;
    assert!(label.is_some(), "Label should be found");

    let label = label.unwrap();
    assert_eq!(label.id, label_id);
    assert_eq!(label.link_id, link_id);
    assert_eq!(label.provider_label_id, "INBOX");
    assert_eq!(label.name, "INBOX");
    assert_eq!(label.message_list_visibility, MessageListVisibility::Show);
    assert_eq!(label.label_list_visibility, LabelListVisibility::LabelShow);
    assert_eq!(label.type_, LabelType::System);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_get_label_by_id_user_label(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let label_id = Uuid::parse_str("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")?;

    let label = repo.get_label_by_id(label_id, link_id).await?;
    assert!(label.is_some());

    let label = label.unwrap();
    assert_eq!(label.provider_label_id, "Label_123");
    assert_eq!(label.name, "MyCustomLabel");
    assert_eq!(label.type_, LabelType::User);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_get_label_by_id_wrong_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    // Label belongs to link aaa..., but we look it up with link bbb...
    let label_id = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;
    let wrong_link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;

    let label = repo.get_label_by_id(label_id, wrong_link_id).await?;
    assert!(label.is_none(), "Label should not be found for wrong link");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_get_label_by_id_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let nonexistent = Uuid::parse_str("99999999-9999-9999-9999-999999999999")?;

    let label = repo.get_label_by_id(nonexistent, link_id).await?;
    assert!(label.is_none());

    Ok(())
}

// ── get_thread_label_messages ───────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_get_thread_label_messages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let messages = repo.get_thread_label_messages(thread_id, link_id).await?;
    assert_eq!(messages.len(), 2, "Thread 1 should have 2 messages");

    // Ordered by internal_date_ts DESC, so msg1b (11:00) comes first
    assert_eq!(messages[0].provider_id.as_deref(), Some("msg1b"));
    assert_eq!(messages[1].provider_id.as_deref(), Some("msg1a"));

    // Verify fields are populated
    assert_eq!(messages[0].thread_db_id, thread_id);
    assert_eq!(messages[0].link_id, link_id);
    assert!(!messages[0].is_read);
    assert!(!messages[0].is_starred);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_get_thread_label_messages_empty_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    // Thread 2 exists but has no messages
    let thread_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;

    let messages = repo.get_thread_label_messages(thread_id, link_id).await?;
    assert!(
        messages.is_empty(),
        "Thread with no messages should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_get_thread_label_messages_wrong_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let wrong_link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let messages = repo
        .get_thread_label_messages(thread_id, wrong_link_id)
        .await?;
    assert!(
        messages.is_empty(),
        "Should not return messages for wrong link"
    );

    Ok(())
}

// ── insert_message_labels_batch ─────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_insert_message_labels_batch(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let msg1b = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;
    let unread_label_id = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc")?;

    // Add UNREAD label to both messages
    repo.insert_message_labels_batch(&[msg1a, msg1b], "UNREAD", link_id)
        .await?;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_message_labels WHERE label_id = $1 AND message_id = ANY($2)",
    )
    .bind(unread_label_id)
    .bind(&[msg1a, msg1b])
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 2, "Both messages should have the UNREAD label");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_insert_message_labels_batch_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;

    // msg1a already has INBOX label from fixture — inserting again should not error
    repo.insert_message_labels_batch(&[msg1a], "INBOX", link_id)
        .await?;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_message_labels WHERE message_id = $1 AND label_id = $2",
    )
    .bind(msg1a)
    .bind(Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?)
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        count, 1,
        "Should still be exactly 1 row (ON CONFLICT DO NOTHING)"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_insert_message_labels_batch_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    // Should be a no-op, not an error
    repo.insert_message_labels_batch(&[], "INBOX", link_id)
        .await?;

    Ok(())
}

// ── delete_message_labels_batch ─────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_delete_message_labels_batch(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let msg1b = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;
    let inbox_label_id = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;

    // Both messages have INBOX label from fixture
    repo.delete_message_labels_batch(&[msg1a, msg1b], "INBOX", link_id)
        .await?;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_message_labels WHERE label_id = $1 AND message_id = ANY($2)",
    )
    .bind(inbox_label_id)
    .bind(&[msg1a, msg1b])
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 0, "INBOX label should be removed from both messages");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_delete_message_labels_batch_nonexistent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;

    // Messages don't have UNREAD label — should be a no-op
    repo.delete_message_labels_batch(&[msg1a], "UNREAD", link_id)
        .await?;

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_delete_message_labels_batch_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    repo.delete_message_labels_batch(&[], "INBOX", link_id)
        .await?;

    Ok(())
}

// ── update_message_read_status_batch ────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_update_message_read_status_batch_mark_read(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let msg1b = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;

    // Both messages start as unread (is_read=false in fixture)
    repo.update_message_read_status_batch(&[msg1a, msg1b], link_id, true)
        .await?;

    let rows: Vec<bool> =
        sqlx::query_scalar("SELECT is_read FROM email_messages WHERE id = ANY($1) ORDER BY id")
            .bind(&[msg1a, msg1b])
            .fetch_all(&pool)
            .await?;
    assert!(
        rows.iter().all(|&r| r),
        "All messages should be marked as read"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_update_message_read_status_batch_wrong_link(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let wrong_link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;

    // Should not update — message belongs to a different link
    repo.update_message_read_status_batch(&[msg1a], wrong_link_id, true)
        .await?;

    let is_read: bool = sqlx::query_scalar("SELECT is_read FROM email_messages WHERE id = $1")
        .bind(msg1a)
        .fetch_one(&pool)
        .await?;
    assert!(!is_read, "Message should remain unread (wrong link_id)");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_update_message_read_status_batch_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    repo.update_message_read_status_batch(&[], link_id, true)
        .await?;

    Ok(())
}

// ── update_message_starred_status_batch ─────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_update_message_starred_status_batch_star(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let msg1b = Uuid::parse_str("11111111-bbbb-bbbb-bbbb-111111111111")?;

    // Both messages start as not starred (is_starred=false in fixture)
    repo.update_message_starred_status_batch(&[msg1a, msg1b], link_id, true)
        .await?;

    let rows: Vec<bool> =
        sqlx::query_scalar("SELECT is_starred FROM email_messages WHERE id = ANY($1) ORDER BY id")
            .bind(&[msg1a, msg1b])
            .fetch_all(&pool)
            .await?;
    assert!(rows.iter().all(|&s| s), "All messages should be starred");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_update_message_starred_status_batch_unstar(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;

    // Star first, then unstar
    repo.update_message_starred_status_batch(&[msg1a], link_id, true)
        .await?;
    repo.update_message_starred_status_batch(&[msg1a], link_id, false)
        .await?;

    let is_starred: bool =
        sqlx::query_scalar("SELECT is_starred FROM email_messages WHERE id = $1")
            .bind(msg1a)
            .fetch_one(&pool)
            .await?;
    assert!(!is_starred, "Message should be unstarred");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_update_message_starred_status_batch_wrong_link(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let wrong_link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;
    let msg1a = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;

    repo.update_message_starred_status_batch(&[msg1a], wrong_link_id, true)
        .await?;

    let is_starred: bool =
        sqlx::query_scalar("SELECT is_starred FROM email_messages WHERE id = $1")
            .bind(msg1a)
            .fetch_one(&pool)
            .await?;
    assert!(
        !is_starred,
        "Message should remain unstarred (wrong link_id)"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_update_message_starred_status_batch_empty(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    repo.update_message_starred_status_batch(&[], link_id, true)
        .await?;

    Ok(())
}
