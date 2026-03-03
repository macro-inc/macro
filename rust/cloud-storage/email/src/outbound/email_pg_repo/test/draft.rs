use super::*;
use crate::domain::models::{
    ContactInfo, ParsedAddresses, RecipientType, ResolvedDraftInput, ThreadRow, UpsertedContacts,
    UpsertedRecipient,
};
use chrono::Utc;
use sqlx::Row;

// ── get_simple_message ────────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_simple_message_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let result = repo.get_simple_message(msg_id, link_id).await?;

    let info = result.expect("Message should be found");
    assert_eq!(info.db_id, msg_id);
    assert_eq!(
        info.thread_db_id,
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?
    );
    assert_eq!(
        info.provider_thread_id.as_deref(),
        Some("provider-thread-1")
    );
    assert!(info.is_sent);
    assert!(!info.is_draft);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_simple_message_wrong_link_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let wrong_link = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;
    let result = repo.get_simple_message(msg_id, wrong_link).await?;

    assert!(result.is_none(), "Wrong link_id should return None");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_simple_message_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let missing = Uuid::parse_str("99999999-9999-9999-9999-999999999999")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let result = repo.get_simple_message(missing, link_id).await?;

    assert!(result.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_simple_message_draft_with_headers(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg_id = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let result = repo.get_simple_message(msg_id, link_id).await?;

    let info = result.expect("Draft should be found");
    assert!(info.is_draft);
    assert!(!info.is_sent);
    assert!(info.headers_json.is_some(), "Headers should be present");

    Ok(())
}

// ── get_draft_replying_to ─────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_draft_replying_to_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let replying_to = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let result = repo.get_draft_replying_to(link_id, replying_to).await?;

    let info = result.expect("Should find the draft replying to msg1");
    assert_eq!(
        info.db_id,
        Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?
    );
    assert!(info.is_draft);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_draft_replying_to_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let no_reply = Uuid::parse_str("ee000003-0000-0000-0000-000000000003")?;
    let result = repo.get_draft_replying_to(link_id, no_reply).await?;

    assert!(result.is_none(), "No draft replies to msg3");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_draft_replying_to_wrong_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let wrong_link = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;
    let replying_to = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let result = repo.get_draft_replying_to(wrong_link, replying_to).await?;

    assert!(result.is_none(), "Wrong link_id should find nothing");

    Ok(())
}

// ── upsert_contacts ───────────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_contacts_existing_contacts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let addresses = ParsedAddresses {
        from_email: "alice@example.com".to_string(),
        from_name: Some("Alice Smith".to_string()),
        to: vec![ContactInfo {
            email: "bob@example.com".to_string(),
            name: Some("Bob Jones".to_string()),
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
    };

    let result = repo.upsert_contacts(link_id, addresses).await?;

    assert!(
        result.from_contact_id.is_some(),
        "Alice should have a contact ID"
    );
    assert_eq!(
        result.from_contact_id,
        Some(Uuid::parse_str("c0000001-0000-0000-0000-000000000001")?)
    );
    assert_eq!(result.recipients.len(), 1);
    assert_eq!(
        result.recipients[0].contact_id,
        Uuid::parse_str("c0000002-0000-0000-0000-000000000002")?
    );
    assert_eq!(result.recipients[0].recipient_type, RecipientType::To);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_contacts_new_contact(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let addresses = ParsedAddresses {
        from_email: "alice@example.com".to_string(),
        from_name: None,
        to: vec![ContactInfo {
            email: "newuser@example.com".to_string(),
            name: Some("New User".to_string()),
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
    };

    let result = repo.upsert_contacts(link_id, addresses).await?;

    assert!(result.from_contact_id.is_some());
    assert_eq!(result.recipients.len(), 1);
    // New contact should have been created with a new UUID
    assert_ne!(
        result.recipients[0].contact_id,
        Uuid::parse_str("c0000001-0000-0000-0000-000000000001")?
    );
    assert_eq!(result.recipients[0].recipient_type, RecipientType::To);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_contacts_fills_missing_name(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    // carol has no name in the fixture
    let addresses = ParsedAddresses {
        from_email: "carol@example.com".to_string(),
        from_name: Some("Carol White".to_string()),
        to: vec![],
        cc: vec![],
        bcc: vec![],
    };

    let result = repo.upsert_contacts(link_id, addresses).await?;
    assert!(result.from_contact_id.is_some());

    // Verify the name was updated using non-macro query
    let row = sqlx::query("SELECT name FROM email_contacts WHERE id = $1")
        .bind(Uuid::parse_str("c0000003-0000-0000-0000-000000000003")?)
        .fetch_one(&pool)
        .await?;

    let name: Option<String> = row.get("name");
    assert_eq!(name.as_deref(), Some("Carol White"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_contacts_mixed_to_cc_bcc(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let addresses = ParsedAddresses {
        from_email: "alice@example.com".to_string(),
        from_name: None,
        to: vec![ContactInfo {
            email: "bob@example.com".to_string(),
            name: None,
            photo_url: None,
        }],
        cc: vec![ContactInfo {
            email: "carol@example.com".to_string(),
            name: None,
            photo_url: None,
        }],
        bcc: vec![ContactInfo {
            email: "newbcc@example.com".to_string(),
            name: Some("BCC User".to_string()),
            photo_url: None,
        }],
    };

    let result = repo.upsert_contacts(link_id, addresses).await?;

    assert_eq!(result.recipients.len(), 3);
    assert_eq!(result.recipients[0].recipient_type, RecipientType::To);
    assert_eq!(result.recipients[1].recipient_type, RecipientType::Cc);
    assert_eq!(result.recipients[2].recipient_type, RecipientType::Bcc);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_contacts_case_insensitive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let addresses = ParsedAddresses {
        from_email: "ALICE@EXAMPLE.COM".to_string(),
        from_name: None,
        to: vec![ContactInfo {
            email: "Bob@Example.COM".to_string(),
            name: None,
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
    };

    let result = repo.upsert_contacts(link_id, addresses).await?;

    // Should resolve to the same existing contacts despite different casing
    assert_eq!(
        result.from_contact_id,
        Some(Uuid::parse_str("c0000001-0000-0000-0000-000000000001")?)
    );
    assert_eq!(
        result.recipients[0].contact_id,
        Uuid::parse_str("c0000002-0000-0000-0000-000000000002")?
    );

    Ok(())
}

// ── insert_draft_message ──────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_draft_message_into_existing_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_db_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let message_db_id = Uuid::parse_str("dd000001-0000-0000-0000-000000000001")?;
    let from_contact_id = Uuid::parse_str("c0000001-0000-0000-0000-000000000001")?;
    let to_contact_id = Uuid::parse_str("c0000002-0000-0000-0000-000000000002")?;

    let input = ResolvedDraftInput {
        db_id: message_db_id,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: Some("provider-thread-2".to_string()),
        thread_db_id,
        subject: "Test draft".to_string(),
        to: vec![ContactInfo {
            email: "bob@example.com".to_string(),
            name: Some("Bob".to_string()),
            photo_url: None,
        }],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Hello".to_string()),
        body_html: Some("<p>Hello</p>".to_string()),
        body_macro: None,
        headers_json: None,
        send_time: None,
    };

    let contacts = UpsertedContacts {
        from_contact_id: Some(from_contact_id),
        recipients: vec![UpsertedRecipient {
            contact_id: to_contact_id,
            name: Some("Bob".to_string()),
            recipient_type: RecipientType::To,
        }],
    };

    repo.insert_message(&input, &contacts, link_id, None, true)
        .await?;

    // Verify the message was inserted
    let msg = sqlx::query(
        "SELECT thread_id, subject, is_draft, body_text FROM email_messages WHERE id = $1",
    )
    .bind(message_db_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(msg.get::<Uuid, _>("thread_id"), thread_db_id);
    assert_eq!(
        msg.get::<Option<String>, _>("subject").as_deref(),
        Some("Test draft")
    );
    assert!(msg.get::<bool, _>("is_draft"));
    assert_eq!(
        msg.get::<Option<String>, _>("body_text").as_deref(),
        Some("Hello")
    );

    // Verify recipients were inserted
    let recip_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_message_recipients WHERE message_id = $1")
            .bind(message_db_id)
            .fetch_one(&pool)
            .await?;

    assert_eq!(recip_count, 1);

    // Verify user history was upserted
    let history_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_user_history WHERE link_id = $1 AND thread_id = $2",
    )
    .bind(link_id)
    .bind(thread_db_id)
    .fetch_one(&pool)
    .await?;

    assert_eq!(history_count, 1, "User history should be created");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_draft_message_with_new_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let new_thread_id = Uuid::parse_str("44444444-4444-4444-4444-444444444444")?;
    let message_db_id = Uuid::parse_str("dd000002-0000-0000-0000-000000000002")?;
    let from_contact_id = Uuid::parse_str("c0000001-0000-0000-0000-000000000001")?;

    let input = ResolvedDraftInput {
        db_id: message_db_id,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id: new_thread_id,
        subject: "Brand new thread draft".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: Some("New thread body".to_string()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
    };

    let contacts = UpsertedContacts {
        from_contact_id: Some(from_contact_id),
        recipients: vec![],
    };

    let new_thread = ThreadRow {
        db_id: new_thread_id,
        provider_id: None,
        link_id,
        inbox_visible: true,
        is_read: true,
        latest_inbound_message_ts: None,
        latest_outbound_message_ts: None,
        latest_non_spam_message_ts: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    repo.insert_message(&input, &contacts, link_id, Some(new_thread), true)
        .await?;

    // Verify the thread was created
    let thread_link: Uuid = sqlx::query_scalar("SELECT link_id FROM email_threads WHERE id = $1")
        .bind(new_thread_id)
        .fetch_one(&pool)
        .await?;

    assert_eq!(thread_link, link_id);

    // Verify the message references the new thread
    let msg_thread: Uuid = sqlx::query_scalar("SELECT thread_id FROM email_messages WHERE id = $1")
        .bind(message_db_id)
        .fetch_one(&pool)
        .await?;

    assert_eq!(msg_thread, new_thread_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_draft_message_with_scheduled_send(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_db_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let message_db_id = Uuid::parse_str("dd000003-0000-0000-0000-000000000003")?;
    let send_time =
        chrono::DateTime::parse_from_rfc3339("2025-06-01T12:00:00Z")?.with_timezone(&Utc);

    let input = ResolvedDraftInput {
        db_id: message_db_id,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id,
        subject: "Scheduled draft".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: None,
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: Some(send_time),
    };

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };

    repo.insert_message(&input, &contacts, link_id, None, true)
        .await?;

    // Verify the scheduled message was created
    let row =
        sqlx::query("SELECT send_time, sent FROM email_scheduled_messages WHERE message_id = $1")
            .bind(message_db_id)
            .fetch_one(&pool)
            .await?;

    assert_eq!(row.get::<chrono::DateTime<Utc>, _>("send_time"), send_time);
    assert!(!row.get::<bool, _>("sent"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_draft_message_upsert_existing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_db_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    // Re-use the existing draft message ID (msg2)
    let message_db_id = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;

    let input = ResolvedDraftInput {
        db_id: message_db_id,
        provider_id: None,
        replying_to_id: Some(Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?),
        provider_thread_id: Some("provider-thread-1".to_string()),
        thread_db_id,
        subject: "Updated draft subject".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: Some("Updated body".to_string()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
    };

    let contacts = UpsertedContacts {
        from_contact_id: Some(Uuid::parse_str("c0000001-0000-0000-0000-000000000001")?),
        recipients: vec![],
    };

    repo.insert_message(&input, &contacts, link_id, None, true)
        .await?;

    // Verify the message was updated (not duplicated)
    let row = sqlx::query("SELECT subject, body_text FROM email_messages WHERE id = $1")
        .bind(message_db_id)
        .fetch_one(&pool)
        .await?;

    assert_eq!(
        row.get::<Option<String>, _>("subject").as_deref(),
        Some("Updated draft subject")
    );
    assert_eq!(
        row.get::<Option<String>, _>("body_text").as_deref(),
        Some("Updated body")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_draft_message_updates_thread_metadata(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_db_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let message_db_id = Uuid::parse_str("dd000004-0000-0000-0000-000000000004")?;

    // Insert a macro draft (no provider_id, is_draft=true) into the thread
    let input = ResolvedDraftInput {
        db_id: message_db_id,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id,
        subject: "Metadata test draft".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: None,
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
    };

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };

    repo.insert_message(&input, &contacts, link_id, None, true)
        .await?;

    // Thread should now be inbox_visible because it has a macro draft
    let row = sqlx::query("SELECT inbox_visible FROM email_threads WHERE id = $1")
        .bind(thread_db_id)
        .fetch_one(&pool)
        .await?;

    assert!(
        row.get::<bool, _>("inbox_visible"),
        "Thread with macro draft should be inbox_visible"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_message_with_is_draft_false(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_db_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let message_db_id = Uuid::parse_str("dd000005-0000-0000-0000-000000000005")?;
    let from_contact_id = Uuid::parse_str("c0000001-0000-0000-0000-000000000001")?;

    let input = ResolvedDraftInput {
        db_id: message_db_id,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id,
        subject: "Sent message".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: Some("This is a sent message".to_string()),
        body_html: None,
        body_macro: None,
        headers_json: None,
        send_time: None,
    };

    let contacts = UpsertedContacts {
        from_contact_id: Some(from_contact_id),
        recipients: vec![],
    };

    repo.insert_message(&input, &contacts, link_id, None, false)
        .await?;

    // Verify the message was inserted with is_draft = false
    let row = sqlx::query("SELECT is_draft, is_sent FROM email_messages WHERE id = $1")
        .bind(message_db_id)
        .fetch_one(&pool)
        .await?;

    assert!(
        !row.get::<bool, _>("is_draft"),
        "Message should have is_draft = false"
    );

    Ok(())
}
