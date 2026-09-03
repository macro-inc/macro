use super::*;
use crate::domain::models::{
    ContactInfo, ParsedAddresses, RecipientType, ResolvedDraftInput, ThreadRow, UpsertedContacts,
    UpsertedRecipient,
};
use chrono::Utc;
use sqlx::Row;
use std::time::Duration;

// ── get_simple_message ────────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_simple_message_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let result = repo.get_simple_message(msg_id, &[link_id]).await?;

    let info = result.expect("Message should be found");
    assert_eq!(info.db_id, msg_id);
    assert_eq!(info.link_id, link_id);
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
    let result = repo.get_simple_message(msg_id, &[wrong_link]).await?;

    assert!(result.is_none(), "Wrong link_id should return None");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_get_simple_message_across_inboxes(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let owning_link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let other_link = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;
    let result = repo
        .get_simple_message(msg_id, &[other_link, owning_link])
        .await?;

    let info = result.expect("Message should be found across the accessible inboxes");
    assert_eq!(
        info.link_id, owning_link,
        "Should report the inbox the message actually lives in"
    );

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
    let result = repo.get_simple_message(missing, &[link_id]).await?;

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
    let result = repo.get_simple_message(msg_id, &[link_id]).await?;

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

// ── delete_draft_message ──────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_delete_draft_message_keeps_nonempty_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let draft_id = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let deletion = repo
        .delete_draft_message(draft_id, thread_id, &[link_id])
        .await?
        .expect("the draft should be deleted");
    assert!(
        !deletion.thread_deleted,
        "a thread that still has messages should not be reported deleted"
    );

    assert!(
        repo.get_simple_message(draft_id, &[link_id])
            .await?
            .is_none(),
        "the draft message should be deleted"
    );
    assert!(
        repo.thread_by_id(thread_id).await?.is_some(),
        "a thread that still has messages should be kept"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_delete_draft_message_removes_empty_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let draft_id = Uuid::parse_str("ee000004-0000-0000-0000-000000000004")?;
    let thread_id = Uuid::parse_str("33333333-3333-3333-3333-333333333333")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let deletion = repo
        .delete_draft_message(draft_id, thread_id, &[link_id])
        .await?
        .expect("the draft should be deleted");
    assert!(
        deletion.thread_deleted,
        "emptying the thread should be reported"
    );

    assert!(
        repo.thread_by_id(thread_id).await?.is_none(),
        "a thread left with no messages should be deleted"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_delete_draft_message_rejects_sent_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // ee000003 is a sent message, not a draft; deleting it must not succeed.
    let sent_id = Uuid::parse_str("ee000003-0000-0000-0000-000000000003")?;
    let thread_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    assert!(
        repo.delete_draft_message(sent_id, thread_id, &[link_id])
            .await?
            .is_none(),
        "deleting a non-draft should match nothing and leave it intact"
    );
    assert!(
        repo.get_simple_message(sent_id, &[link_id])
            .await?
            .is_some(),
        "the sent message must survive"
    );
    assert!(
        repo.thread_by_id(thread_id).await?.is_some(),
        "the thread of a non-draft must be untouched"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_delete_draft_message_rejects_foreign_link_scope(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // The draft exists, but the caller's link scope doesn't include its
    // inbox: the WHERE-clause guard must match nothing and leave the row —
    // this is the enforcement a raced validation read falls back on.
    let draft_id = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let owner_link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let foreign_link = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;

    assert!(
        repo.delete_draft_message(draft_id, thread_id, &[foreign_link])
            .await?
            .is_none(),
        "a delete outside the caller's inboxes must match nothing"
    );
    assert!(
        repo.get_simple_message(draft_id, &[owner_link])
            .await?
            .is_some(),
        "the draft must survive a foreign-scoped delete"
    );

    Ok(())
}

// ── cross_inbox_reply_drafts ──────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_cross_inbox_reply_drafts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let thread1 = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let own_link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let alt_link = Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc")?;
    let moved_draft = Uuid::parse_str("ee000005-0000-0000-0000-000000000005")?;

    // The reply draft moved to the alt inbox is found, but the same-thread draft
    // (ee000002 in thread1) is excluded.
    let found = repo
        .cross_inbox_reply_drafts(&[msg1], &[own_link, alt_link], thread1)
        .await?;
    assert_eq!(
        found.len(),
        1,
        "should surface only the moved cross-inbox draft"
    );
    assert_eq!(found[0].db_id, moved_draft);
    assert_eq!(found[0].link_id, alt_link);

    // Without the alt inbox in scope, nothing is returned (same-thread draft excluded).
    let none = repo
        .cross_inbox_reply_drafts(&[msg1], &[own_link], thread1)
        .await?;
    assert!(
        none.is_empty(),
        "same-thread drafts and inaccessible inboxes must be excluded"
    );

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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
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
        project_id: None,
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn test_insert_draft_message_upsert_existing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread_db_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    // Re-use the existing draft message ID (msg2)
    let message_db_id = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let thread_before = repo
        .thread_by_id(thread_db_id)
        .await?
        .expect("draft thread should exist");

    tokio::time::sleep(Duration::from_millis(10)).await;

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
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
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

    let thread_after = repo
        .thread_by_id(thread_db_id)
        .await?
        .expect("draft thread should still exist");
    assert!(
        thread_after.updated_at > thread_before.updated_at,
        "editing an existing draft should advance its thread timestamp"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
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
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
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
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
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

// ── client-handle mappings / owner-guarded upsert ───────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_client_handle_bindings_resolve_scoped_and_cascade(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let other_link = Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?;
    let draft_id = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let draft_handle = Uuid::parse_str("c11e0001-0000-0000-0000-000000000001")?;
    let thread_handle = Uuid::parse_str("c11e0002-0000-0000-0000-000000000002")?;

    // A save carrying unbound client handles binds them to the settled rows
    // inside the insert transaction.
    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };
    let mut input = resolved_input(draft_id, thread_id);
    input.subject = "Bound".to_string();
    input.draft_client_id = Some(draft_handle);
    input.thread_client_id = Some(thread_handle);
    assert!(
        repo.insert_message(&input, &contacts, link, None, true)
            .await?
    );

    // Lookups are scoped to the caller's inboxes: the owner resolves, and an
    // unrelated inbox sees nothing — identical handles never interact.
    assert_eq!(
        repo.message_id_for_client_draft_id(draft_handle, &[link])
            .await?,
        Some(draft_id)
    );
    assert_eq!(
        repo.thread_id_for_client_thread_id(thread_handle, &[link])
            .await?,
        Some(thread_id)
    );
    assert_eq!(
        repo.message_id_for_client_draft_id(draft_handle, &[other_link])
            .await?,
        None
    );
    assert_eq!(
        repo.thread_id_for_client_thread_id(thread_handle, &[other_link])
            .await?,
        None
    );

    // Deleting the draft cascades its binding away.
    repo.delete_draft_message(draft_id, thread_id, &[link])
        .await?
        .expect("the draft should be deleted");
    assert_eq!(
        repo.message_id_for_client_draft_id(draft_handle, &[link])
            .await?,
        None
    );

    Ok(())
}

fn resolved_input(db_id: Uuid, thread_db_id: Uuid) -> ResolvedDraftInput {
    ResolvedDraftInput {
        db_id,
        provider_id: None,
        replying_to_id: None,
        provider_thread_id: None,
        thread_db_id,
        subject: "Overwritten".to_string(),
        to: vec![],
        cc: vec![],
        bcc: vec![],
        body_text: Some("attacker content".to_string()),
        body_html: Some("<p>attacker content</p>".to_string()),
        body_macro: None,
        headers_json: None,
        send_time: None,
        actor_id: None,
        draft_client_id: None,
        thread_client_id: None,
    }
}

async fn message_snapshot(
    pool: &Pool<Postgres>,
    id: Uuid,
) -> anyhow::Result<(Uuid, Option<String>, Option<String>, bool, bool)> {
    let row = sqlx::query(
        "SELECT link_id, subject, body_text, is_sent, is_draft FROM email_messages WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;
    Ok((
        row.get::<Uuid, _>("link_id"),
        row.get::<Option<String>, _>("subject"),
        row.get::<Option<String>, _>("body_text"),
        row.get::<bool, _>("is_sent"),
        row.get::<bool, _>("is_draft"),
    ))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_guard_rejects_cross_inbox_overwrite(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    // A draft owned by the cccc inbox; the write is issued from aaaa. The
    // IDs reaching the upsert come from validated reads, but reads race —
    // the conflict clause, not the read, is what must hold the line.
    let victim = Uuid::parse_str("ee000005-0000-0000-0000-000000000005")?;
    let attacker_link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let attacker_thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let before = message_snapshot(&pool, victim).await?;

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };
    let applied = repo
        .insert_message(
            &resolved_input(victim, attacker_thread),
            &contacts,
            attacker_link,
            None,
            true,
        )
        .await?;

    assert!(!applied, "owner guard must reject a cross-inbox overwrite");
    let after = message_snapshot(&pool, victim).await?;
    assert_eq!(before, after, "victim row must be untouched");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_guard_rejects_sent_message_overwrite(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());

    // Same inbox, but the row is a sent message — no draft save may rewrite it.
    let victim = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;

    let before = message_snapshot(&pool, victim).await?;

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };
    let applied = repo
        .insert_message(&resolved_input(victim, thread), &contacts, link, None, true)
        .await?;

    assert!(!applied, "owner guard must reject rewriting a sent message");
    let after = message_snapshot(&pool, victim).await?;
    assert_eq!(before, after, "sent message must be untouched");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_insert_message_reports_applied_on_create(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let link = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let thread = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let fresh_id = Uuid::parse_str("dd000002-0000-0000-0000-000000000002")?;

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };
    let applied = repo
        .insert_message(&resolved_input(fresh_id, thread), &contacts, link, None, true)
        .await?;

    assert!(applied, "a fresh unclaimed id inserts normally");

    Ok(())
}
