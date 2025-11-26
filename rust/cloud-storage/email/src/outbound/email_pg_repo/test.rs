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
