use super::*;
use crate::domain::models::LabelType;
use crate::domain::ports::EmailRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_single_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("11111111-1111-1111-1111-111111111111")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 2, "Thread 1 should have 2 labels");

    let inbox_label = labels.iter().find(|l| l.name == "INBOX");
    assert!(inbox_label.is_some(), "Should have INBOX label");

    let important_label = labels.iter().find(|l| l.name == "IMPORTANT");
    assert!(important_label.is_some(), "Should have IMPORTANT label");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_multiple_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?,
        Uuid::parse_str("22222222-2222-2222-2222-222222222222")?,
    ];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    // Thread 1 has 2 labels (INBOX, IMPORTANT)
    // Thread 2 has 2 labels (INBOX, SENT)
    // Should get four unique labels as it's distinct across (thread_id, label_id)
    assert_eq!(
        labels.len(),
        4,
        "Should have 4 unique labels across both threads"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_no_duplicate_labels_same_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // Thread 3 has multiple messages with the same label
    let thread_ids = vec![Uuid::parse_str("33333333-3333-3333-3333-333333333333")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(
        labels.len(),
        1,
        "Should have only 1 label despite multiple messages having it"
    );
    assert_eq!(labels[0].name, "INBOX");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_thread_with_no_labels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("44444444-4444-4444-4444-444444444444")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(
        labels.len(),
        0,
        "Thread with no messages/labels should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids: Vec<Uuid> = vec![];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 0, "Empty input should return empty result");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_different_label_types(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("55555555-5555-5555-5555-555555555555")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 2, "Should have both system and user labels");

    let system_label = labels.iter().find(|l| l.name == "INBOX");
    assert!(system_label.is_some());
    assert_eq!(system_label.unwrap().type_, LabelType::System);

    let user_label = labels.iter().find(|l| l.name == "MyCustomLabel");
    assert!(user_label.is_some());
    assert_eq!(user_label.unwrap().type_, LabelType::User);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread_metadata"))
)]
async fn test_thread_metadata_has_table(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let metadata = repo.thread_metadata_by_thread_ids(&[thread_id]).await?;

    assert_eq!(metadata.len(), 1);
    let item = &metadata[0];

    assert_eq!(item.thread_id, thread_id);
    assert!(item.has_table, "Should detect HTML table");
    assert!(
        !item.has_calendar_invite,
        "Should not detect calendar invite"
    );
    assert_eq!(item.sender_emails.len(), 1);
    assert_eq!(item.sender_emails[0], "sender1@example.com");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread_metadata"))
)]
async fn test_thread_metadata_has_calendar_invite(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let thread_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;

    let metadata = repo.thread_metadata_by_thread_ids(&[thread_id]).await?;

    assert_eq!(metadata.len(), 1);
    let item = &metadata[0];

    assert_eq!(item.thread_id, thread_id);
    assert!(!item.has_table, "Should not detect HTML table");
    assert!(item.has_calendar_invite, "Should detect calendar invite");

    // Verify multiple senders are collected
    assert_eq!(item.sender_emails.len(), 2);
    assert!(
        item.sender_emails
            .contains(&"sender1@example.com".to_string())
    );
    assert!(
        item.sender_emails
            .contains(&"sender2@example.com".to_string())
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread_metadata"))
)]
async fn test_thread_metadata_sender_deduplication(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    // Thread 3 has 2 messages from the same sender
    let thread_id = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;

    let metadata = repo.thread_metadata_by_thread_ids(&[thread_id]).await?;

    assert_eq!(metadata.len(), 1);
    let item = &metadata[0];

    assert_eq!(
        item.sender_emails.len(),
        1,
        "Should deduplicate identical senders"
    );
    assert_eq!(item.sender_emails[0], "sender1@example.com");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_thread_metadata"))
)]
async fn test_thread_metadata_batch_retrieval(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let t1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let t2 = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;

    let metadata = repo.thread_metadata_by_thread_ids(&[t1, t2]).await?;

    assert_eq!(metadata.len(), 2);

    let meta1 = metadata.iter().find(|m| m.thread_id == t1).unwrap();
    assert!(meta1.has_table);

    let meta2 = metadata.iter().find(|m| m.thread_id == t2).unwrap();
    assert!(meta2.has_calendar_invite);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("threads_with_known_senders"))
)]
async fn test_known_senders_single_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Thread 1 is from Known Contact A
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let result = repo
        .threads_with_known_senders(&link_id, &[thread_id])
        .await?;

    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0], thread_id,
        "Should identify thread from known sender"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("threads_with_known_senders"))
)]
async fn test_known_senders_no_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Thread 2 is from Unknown Contact B
    let thread_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;

    let result = repo
        .threads_with_known_senders(&link_id, &[thread_id])
        .await?;

    assert!(
        result.is_empty(),
        "Should NOT return thread from unknown sender"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("threads_with_known_senders"))
)]
async fn test_known_senders_mixed_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    let t1_known = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let t2_unknown = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let t3_known = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;

    let result = repo
        .threads_with_known_senders(&link_id, &[t1_known, t2_unknown, t3_known])
        .await?;

    assert_eq!(result.len(), 2);
    assert!(result.contains(&t1_known));
    assert!(result.contains(&t3_known));
    assert!(!result.contains(&t2_unknown));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("threads_with_known_senders"))
)]
async fn test_known_senders_mixed_thread_participants(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

    // Thread 4 has messages from both Unknown B and Known A
    let thread_id = Uuid::parse_str("44444444-4444-4444-4444-444444444444")?;

    let result = repo
        .threads_with_known_senders(&link_id, &[thread_id])
        .await?;

    assert_eq!(
        result.len(),
        1,
        "Should match because at least one participant is known"
    );
    assert_eq!(result[0], thread_id);

    Ok(())
}
