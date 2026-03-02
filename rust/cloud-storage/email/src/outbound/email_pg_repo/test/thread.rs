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
