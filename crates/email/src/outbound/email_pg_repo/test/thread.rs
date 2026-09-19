use std::time::Duration;

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
async fn thread_metadata_by_ids_returns_canonical_rows(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let first_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let second_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let missing_id = Uuid::parse_str("99999999-9999-9999-9999-999999999999")?;
    let canonical_link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let mut metadata = repo
        .thread_metadata_by_ids(&[first_id, missing_id, second_id])
        .await?;
    metadata.sort_by_key(|row| row.thread_id);

    assert_eq!(metadata.len(), 2);
    assert_eq!(metadata[0].thread_id, first_id);
    assert_eq!(metadata[0].link_id, canonical_link_id);
    assert!(metadata[0].latest_inbound_message_ts.is_some());
    assert_eq!(metadata[1].thread_id, second_id);
    assert_eq!(metadata[1].link_id, canonical_link_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_dynamic_query"))
)]
async fn moving_thread_to_project_advances_thread_timestamp(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str("20000001-0000-0000-0000-000000000001")?;
    let new_project_id = "proj-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    let repo = EmailPgRepo::new(pool);
    let original_updated_at = repo.thread_by_id(thread_id).await?.unwrap().updated_at;

    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(
        repo.update_thread_project(thread_id, Some(new_project_id))
            .await?
    );

    let updated_thread = repo.thread_by_id(thread_id).await?.unwrap();
    assert_eq!(updated_thread.project_id.as_deref(), Some(new_project_id));
    assert!(updated_thread.updated_at > original_updated_at);

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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_messages_by_thread_id_paginated_dateless_message_not_page_head(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Thread 4 has a real dated message carrying the subject and an earlier dateless,
    // subjectless one. A single-row fetch must return the subject-bearing message, not
    // the dateless one that a bare `internal_date_ts DESC` floats to the top on NULL.
    let repo = EmailPgRepo::new(pool);

    let thread_id = Uuid::parse_str("44444444-4444-4444-4444-444444444444")?;

    let preview = repo
        .messages_by_thread_id_paginated(thread_id, 0, 1)
        .await?;
    assert_eq!(preview.len(), 1);
    assert_eq!(preview[0].provider_id.as_deref(), Some("msg-4-real"));
    assert_eq!(
        preview[0].subject.as_deref(),
        Some("Change workspace name and emails"),
        "limit-1 fetch must return the subject-bearing message"
    );

    // The dateless message still comes back, ordered after the real one.
    let all = repo
        .messages_by_thread_id_paginated(thread_id, 0, 50)
        .await?;
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].provider_id.as_deref(), Some("msg-4-real"));
    assert_eq!(all[1].provider_id.as_deref(), Some("msg-4-dateless"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_latest_content_messages_are_batched_and_exclude_drafts(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let thread_2 = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let draft_id = Uuid::parse_str("ffffffff-aaaa-0001-aaaa-ffffffffffff")?;
    sqlx::query(
        r#"
        INSERT INTO email_messages
            (id, thread_id, link_id, internal_date_ts, subject, is_draft, created_at, updated_at)
        VALUES ($1, $2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                '2025-03-01 00:00:00+00', 'private draft', true, NOW(), NOW())
        "#,
    )
    .bind(draft_id)
    .bind(thread_1)
    .execute(&pool)
    .await?;

    let repo = EmailPgRepo::new(pool);
    let rows = repo
        .latest_content_message_rows(&[thread_1, thread_2])
        .await?;
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows.iter()
            .find(|row| row.thread_db_id == thread_1)
            .and_then(|row| row.provider_id.as_deref()),
        Some("msg-1-newest")
    );

    assert!(rows.iter().all(|row| row.db_id != draft_id));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread"))
)]
async fn test_latest_content_message_uses_id_as_timestamp_tiebreaker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let lower_id = Uuid::parse_str("22222222-aaaa-0002-aaaa-222222222222")?;
    let higher_id = Uuid::parse_str("22222222-aaaa-0003-aaaa-222222222222")?;
    for (id, subject) in [(lower_id, "lower"), (higher_id, "higher")] {
        sqlx::query(
            r#"
            INSERT INTO email_messages
                (id, thread_id, link_id, internal_date_ts, subject, created_at, updated_at)
            VALUES ($1, $2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    '2025-03-01 00:00:00+00', $3, NOW(), NOW())
            "#,
        )
        .bind(id)
        .bind(thread_id)
        .bind(subject)
        .execute(&pool)
        .await?;
    }

    let repo = EmailPgRepo::new(pool);
    let rows = repo.latest_content_message_rows(&[thread_id]).await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].db_id, higher_id);
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
        project_id: None,
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
        project_id: None,
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
