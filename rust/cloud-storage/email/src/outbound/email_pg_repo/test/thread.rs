use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_thread_by_id_exists(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let thread = repo.thread_by_id(thread_id).await?;

    assert!(thread.is_some(), "Thread should exist");
    let thread = thread.unwrap();
    assert_eq!(thread.db_id, thread_id);
    assert_eq!(thread.provider_id.as_deref(), Some("provider-thread-1"));
    assert_eq!(
        thread.link_id,
        Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?
    );
    assert!(thread.inbox_visible);
    assert!(!thread.is_read);
    assert!(thread.latest_inbound_message_ts.is_some());
    assert!(thread.latest_outbound_message_ts.is_some());
    assert!(thread.latest_non_spam_message_ts.is_some());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_thread_by_id_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("99999999-9999-9999-9999-999999999999")?;
    let thread = repo.thread_by_id(thread_id).await?;

    assert!(thread.is_none(), "Non-existent thread should return None");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_thread_by_id_nullable_timestamps(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let thread = repo.thread_by_id(thread_id).await?.unwrap();

    assert!(!thread.inbox_visible);
    assert!(thread.is_read);
    assert!(thread.latest_inbound_message_ts.is_some());
    assert!(
        thread.latest_outbound_message_ts.is_none(),
        "Thread 2 has no outbound timestamp"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_messages_by_thread_id_paginated_returns_all(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let messages = repo
        .messages_by_thread_id_paginated(thread_id, 0, 50)
        .await?;

    assert_eq!(messages.len(), 3, "Thread 1 should have 3 messages");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_messages_by_thread_id_paginated_ordered_by_date_desc(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let messages = repo
        .messages_by_thread_id_paginated(thread_id, 0, 50)
        .await?;

    assert_eq!(messages.len(), 3);
    assert_eq!(
        messages[0].provider_id.as_deref(),
        Some("msg-1-newest"),
        "First message should be newest"
    );
    assert_eq!(
        messages[1].provider_id.as_deref(),
        Some("msg-1-middle"),
        "Second message should be middle"
    );
    assert_eq!(
        messages[2].provider_id.as_deref(),
        Some("msg-1-oldest"),
        "Third message should be oldest"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_messages_by_thread_id_paginated_with_offset_and_limit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    // Get first page (limit 2)
    let page1 = repo
        .messages_by_thread_id_paginated(thread_id, 0, 2)
        .await?;
    assert_eq!(page1.len(), 2, "First page should have 2 messages");
    assert_eq!(page1[0].provider_id.as_deref(), Some("msg-1-newest"));
    assert_eq!(page1[1].provider_id.as_deref(), Some("msg-1-middle"));

    // Get second page (offset 2, limit 2)
    let page2 = repo
        .messages_by_thread_id_paginated(thread_id, 2, 2)
        .await?;
    assert_eq!(page2.len(), 1, "Second page should have 1 message");
    assert_eq!(page2[0].provider_id.as_deref(), Some("msg-1-oldest"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_messages_by_thread_id_paginated_empty_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let messages = repo
        .messages_by_thread_id_paginated(thread_id, 0, 50)
        .await?;

    assert_eq!(messages.len(), 0, "Empty thread should return no messages");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_messages_by_thread_id_paginated_fields_populated(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let messages = repo
        .messages_by_thread_id_paginated(thread_id, 0, 50)
        .await?;

    // Check the newest message has expected fields
    let newest = &messages[0];
    assert_eq!(newest.provider_id.as_deref(), Some("msg-1-newest"));
    assert_eq!(newest.subject.as_deref(), Some("Re: Re: Hello"));
    assert_eq!(newest.snippet.as_deref(), Some("Latest reply"));
    assert!(!newest.is_read);
    assert!(!newest.is_sent);
    assert!(!newest.is_draft);
    assert!(newest.has_attachments);

    // Check the middle message
    let middle = &messages[1];
    assert!(middle.is_read);
    assert!(middle.is_sent);

    Ok(())
}

// ── insert_thread ─────────────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_thread_new(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let new_id = Uuid::parse_str("55555555-5555-5555-5555-555555555555")?;
    let now = chrono::Utc::now();

    let thread = crate::domain::models::ThreadRow {
        db_id: new_id,
        provider_id: None,
        link_id,
        inbox_visible: false,
        is_read: true,
        latest_inbound_message_ts: None,
        latest_outbound_message_ts: None,
        latest_non_spam_message_ts: None,
        created_at: now,
        updated_at: now,
    };

    let mut tx = pool.begin().await?;
    let returned_id = super::super::thread::insert_thread(&mut *tx, &thread, link_id).await?;
    tx.commit().await?;

    assert_eq!(returned_id, new_id);

    // Verify it exists
    let repo = EmailPgRepo::new(pool);
    let fetched = repo
        .thread_by_id(new_id)
        .await?
        .expect("Thread should exist");
    assert_eq!(fetched.db_id, new_id);
    assert!(!fetched.inbox_visible);
    assert!(fetched.is_read);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_thread_conflict_with_provider_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let now = chrono::Utc::now();

    // Thread with same provider_id + link_id as fixture thread 1 ("provider-thread-1")
    let thread = crate::domain::models::ThreadRow {
        db_id: Uuid::parse_str("66666666-6666-6666-6666-666666666666")?,
        provider_id: Some("provider-thread-1".to_string()),
        link_id,
        inbox_visible: true,
        is_read: false,
        latest_inbound_message_ts: Some(now),
        latest_outbound_message_ts: None,
        latest_non_spam_message_ts: None,
        created_at: now,
        updated_at: now,
    };

    let mut tx = pool.begin().await?;
    let returned_id = super::super::thread::insert_thread(&mut *tx, &thread, link_id).await?;
    tx.commit().await?;

    // Should return the existing thread's ID, not the new one
    assert_eq!(
        returned_id,
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?
    );

    Ok(())
}

// ── update_thread_metadata ────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_update_thread_metadata_with_inbound_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use sqlx::Row;

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    // Thread 1 has msg1 (sent, INBOX+SENT labels) and msg2 (draft, no provider_id)
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let mut tx = pool.begin().await?;
    super::super::thread::update_thread_metadata(&mut tx, thread_id, link_id).await?;
    tx.commit().await?;

    let row = sqlx::query("SELECT inbox_visible, is_read FROM email_threads WHERE id = $1")
        .bind(thread_id)
        .fetch_one(&pool)
        .await?;

    // msg2 is a macro draft (is_draft=true, no provider_id) → inbox_visible = true
    assert!(row.get::<bool, _>("inbox_visible"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_update_thread_metadata_read_status(pool: Pool<Postgres>) -> anyhow::Result<()> {
    use sqlx::Row;

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    // Thread 2 has msg3 (is_read=true)
    let thread_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;

    let mut tx = pool.begin().await?;
    super::super::thread::update_thread_metadata(&mut tx, thread_id, link_id).await?;
    tx.commit().await?;

    let row = sqlx::query("SELECT is_read FROM email_threads WHERE id = $1")
        .bind(thread_id)
        .fetch_one(&pool)
        .await?;

    // All messages in thread 2 are read → thread should be read
    assert!(row.get::<bool, _>("is_read"));

    Ok(())
}

// ── upsert_user_history ───────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_user_history_insert(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let mut tx = pool.begin().await?;
    super::super::thread::upsert_user_history(&mut *tx, link_id, thread_id).await?;
    tx.commit().await?;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_user_history WHERE link_id = $1 AND thread_id = $2",
    )
    .bind(link_id)
    .bind(thread_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_user_history_updates_timestamp(pool: Pool<Postgres>) -> anyhow::Result<()> {
    use sqlx::Row;

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    // Insert first time
    let mut tx = pool.begin().await?;
    super::super::thread::upsert_user_history(&mut *tx, link_id, thread_id).await?;
    tx.commit().await?;

    let row1 = sqlx::query(
        "SELECT updated_at FROM email_user_history WHERE link_id = $1 AND thread_id = $2",
    )
    .bind(link_id)
    .bind(thread_id)
    .fetch_one(&pool)
    .await?;
    let ts1 = row1.get::<chrono::DateTime<chrono::Utc>, _>("updated_at");

    // Insert again (upsert)
    let mut tx = pool.begin().await?;
    super::super::thread::upsert_user_history(&mut *tx, link_id, thread_id).await?;
    tx.commit().await?;

    let row2 = sqlx::query(
        "SELECT updated_at FROM email_user_history WHERE link_id = $1 AND thread_id = $2",
    )
    .bind(link_id)
    .bind(thread_id)
    .fetch_one(&pool)
    .await?;
    let ts2 = row2.get::<chrono::DateTime<chrono::Utc>, _>("updated_at");

    assert!(ts2 >= ts1, "Second upsert should update the timestamp");

    // Still only one row
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_user_history WHERE link_id = $1 AND thread_id = $2",
    )
    .bind(link_id)
    .bind(thread_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 1);

    Ok(())
}
