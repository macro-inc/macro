use super::*;

// ── attachments_by_thread_ids ───────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_attachments_by_thread_ids_single_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let attachments = repo.attachments_by_thread_ids(&[thread1]).await?;

    assert_eq!(
        attachments.len(),
        2,
        "Thread 1 has 2 attachments (both on msg1)"
    );

    // Ordered by created_at ASC
    assert_eq!(attachments[0].filename.as_deref(), Some("document.pdf"));
    assert_eq!(
        attachments[0].message_id,
        Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?
    );
    assert_eq!(attachments[1].filename.as_deref(), Some("image.png"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_attachments_by_thread_ids_multiple_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let thread3 = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let attachments = repo.attachments_by_thread_ids(&[thread1, thread3]).await?;

    assert_eq!(
        attachments.len(),
        3,
        "Thread 1 has 2 attachments, thread 3 has 1"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_attachments_by_thread_ids_no_attachments(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // Thread 2 only has msg3 (a draft) which has no provider attachments
    let thread2 = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let attachments = repo.attachments_by_thread_ids(&[thread2]).await?;

    assert!(
        attachments.is_empty(),
        "Thread with no provider attachments should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_attachments_by_thread_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let attachments = repo.attachments_by_thread_ids(&[]).await?;
    assert!(attachments.is_empty());

    Ok(())
}

// ── contacts_by_thread_ids ──────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_contacts_by_thread_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let contacts = repo.contacts_by_thread_ids(&[thread1]).await?;

    // Thread 1 has msg1 (from alice) and msg2 (from bob), ordered by created_at ASC
    assert_eq!(contacts.len(), 2, "Thread 1 has 2 sender contacts");

    assert_eq!(
        contacts[0].email_address.as_deref(),
        Some("alice@example.com")
    );
    // msg1 has from_name 'Alice S.' which overrides contact.name 'Alice Smith'
    assert_eq!(contacts[0].name.as_deref(), Some("Alice S."));
    assert_eq!(
        contacts[0].sfs_photo_url.as_deref(),
        Some("https://photos.example.com/alice.jpg")
    );

    assert_eq!(
        contacts[1].email_address.as_deref(),
        Some("bob@example.com")
    );
    // msg2 has no from_name, so contact.name 'Bob Jones' is used
    assert_eq!(contacts[1].name.as_deref(), Some("Bob Jones"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_contacts_by_thread_ids_no_from_contact(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // Thread 2 only has msg3 which has no from_contact_id
    let thread2 = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let contacts = repo.contacts_by_thread_ids(&[thread2]).await?;

    assert!(
        contacts.is_empty(),
        "Thread with no sender contacts should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_contacts_by_thread_ids_multiple_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let thread3 = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let contacts = repo.contacts_by_thread_ids(&[thread1, thread3]).await?;

    // Thread 1: alice + bob, Thread 3: alice (no from_name override)
    assert_eq!(
        contacts.len(),
        3,
        "Should have 3 contacts across both threads"
    );

    // Thread 3's alice should use contact.name since msg4 has no from_name
    let thread3_contact = &contacts[2];
    assert_eq!(
        thread3_contact.email_address.as_deref(),
        Some("alice@example.com")
    );
    assert_eq!(
        thread3_contact.name.as_deref(),
        Some("Alice Smith"),
        "msg4 has no from_name, should use contact.name"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_contacts_by_thread_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let contacts = repo.contacts_by_thread_ids(&[]).await?;
    assert!(contacts.is_empty());

    Ok(())
}
