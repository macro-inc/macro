use super::*;
use crate::domain::models::{RecipientType, UpsertedContacts, UpsertedRecipient};
use chrono::Timelike;
use sqlx::Row;

// ── senders_by_message_ids ──────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_senders_by_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let msg2 = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let senders = repo.senders_by_message_ids(&[msg1, msg2]).await?;

    assert_eq!(senders.len(), 2, "Both messages have senders");

    let sender1 = senders.get(&msg1).expect("msg1 should have a sender");
    assert_eq!(sender1.email, "alice@example.com");
    // from_name ('Alice S.') should take priority over contact.name ('Alice Smith')
    assert_eq!(sender1.name.as_deref(), Some("Alice S."));
    assert_eq!(
        sender1.photo_url.as_deref(),
        Some("https://photos.example.com/alice.jpg")
    );

    let sender2 = senders.get(&msg2).expect("msg2 should have a sender");
    assert_eq!(sender2.email, "bob@example.com");
    // msg2 has no from_name, so contact.name is used
    assert_eq!(sender2.name.as_deref(), Some("Bob Jones"));
    assert!(sender2.photo_url.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_senders_by_message_ids_no_from_contact(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // msg3 is a draft with no from_contact_id
    let msg3 = Uuid::parse_str("ee000003-0000-0000-0000-000000000003")?;
    let senders = repo.senders_by_message_ids(&[msg3]).await?;

    assert!(
        senders.is_empty(),
        "Message without from_contact should not appear"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_senders_by_message_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let senders = repo.senders_by_message_ids(&[]).await?;
    assert!(senders.is_empty());

    Ok(())
}

// ── recipients_by_message_ids ───────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_recipients_by_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let recipients = repo.recipients_by_message_ids(&[msg1]).await?;

    let msg1_recips = recipients.get(&msg1).expect("msg1 should have recipients");
    assert_eq!(msg1_recips.len(), 2, "msg1 has TO and CC recipients");

    // Ordered by recipient_type: TO < CC < BCC
    let (to_contact, to_type) = &msg1_recips[0];
    assert_eq!(*to_type, RecipientType::To);
    assert_eq!(to_contact.email, "bob@example.com");
    // recipient has no name override, falls back to contact.name
    assert_eq!(to_contact.name.as_deref(), Some("Bob Jones"));

    let (cc_contact, cc_type) = &msg1_recips[1];
    assert_eq!(*cc_type, RecipientType::Cc);
    assert_eq!(cc_contact.email, "carol@example.com");
    // recipient has name override 'Carol W.'
    assert_eq!(cc_contact.name.as_deref(), Some("Carol W."));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_recipients_by_message_ids_multiple_messages(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let msg2 = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let recipients = repo.recipients_by_message_ids(&[msg1, msg2]).await?;

    assert_eq!(recipients.len(), 2, "Both messages should have recipients");

    let msg2_recips = recipients.get(&msg2).expect("msg2 should have recipients");
    assert_eq!(msg2_recips.len(), 2, "msg2 has TO and BCC recipients");

    // TO comes before BCC in ordering
    assert_eq!(msg2_recips[0].1, RecipientType::To);
    assert_eq!(msg2_recips[1].1, RecipientType::Bcc);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_recipients_by_message_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let recipients = repo.recipients_by_message_ids(&[]).await?;
    assert!(recipients.is_empty());

    Ok(())
}

// ── labels_by_message_ids ───────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_labels_by_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let labels = repo.labels_by_message_ids(&[msg1]).await?;

    let msg1_labels = labels.get(&msg1).expect("msg1 should have labels");
    assert_eq!(msg1_labels.len(), 2, "msg1 has INBOX and IMPORTANT");

    // Ordered by label name: IMPORTANT < INBOX
    assert_eq!(msg1_labels[0].name.as_deref(), Some("IMPORTANT"));
    assert_eq!(msg1_labels[1].name.as_deref(), Some("INBOX"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_labels_by_message_ids_multiple_messages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let msg2 = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let labels = repo.labels_by_message_ids(&[msg1, msg2]).await?;

    assert_eq!(labels.len(), 2, "Both messages should have labels");

    let msg2_labels = labels.get(&msg2).expect("msg2 should have labels");
    assert_eq!(msg2_labels.len(), 2, "msg2 has INBOX and Work");

    // Ordered by label name: INBOX < Work
    assert_eq!(msg2_labels[0].name.as_deref(), Some("INBOX"));
    assert_eq!(msg2_labels[0].type_, Some(LabelType::System));
    assert_eq!(msg2_labels[1].name.as_deref(), Some("Work"));
    assert_eq!(msg2_labels[1].type_, Some(LabelType::User));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_labels_by_message_ids_no_labels(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // msg3 has no labels
    let msg3 = Uuid::parse_str("ee000003-0000-0000-0000-000000000003")?;
    let labels = repo.labels_by_message_ids(&[msg3]).await?;

    assert!(
        labels.is_empty(),
        "Message with no labels should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_labels_by_message_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let labels = repo.labels_by_message_ids(&[]).await?;
    assert!(labels.is_empty());

    Ok(())
}

// ── attachments_by_message_ids ──────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_attachments_by_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let attachments = repo.attachments_by_message_ids(&[msg1]).await?;

    let msg1_atts = attachments
        .get(&msg1)
        .expect("msg1 should have attachments");
    assert_eq!(msg1_atts.len(), 2, "msg1 has 2 attachments");

    // Ordered by filename: document.pdf < image.png
    assert_eq!(msg1_atts[0].filename.as_deref(), Some("document.pdf"));
    assert_eq!(msg1_atts[0].mime_type.as_deref(), Some("application/pdf"));
    assert_eq!(msg1_atts[0].size_bytes, Some(102400));
    // a0000001 has an sfs mapping
    assert_eq!(
        msg1_atts[0].sfs_id,
        Some(Uuid::parse_str("ff000002-0000-0000-0000-000000000002")?)
    );

    assert_eq!(msg1_atts[1].filename.as_deref(), Some("image.png"));
    assert_eq!(msg1_atts[1].content_id.as_deref(), Some("cid-inline-1"));
    // a0000002 has no sfs mapping
    assert!(msg1_atts[1].sfs_id.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_attachments_by_message_ids_no_attachments(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg2 = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let attachments = repo.attachments_by_message_ids(&[msg2]).await?;

    assert!(
        attachments.is_empty(),
        "Message without attachments should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_attachments_by_message_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let attachments = repo.attachments_by_message_ids(&[]).await?;
    assert!(attachments.is_empty());

    Ok(())
}

// ── draft_attachments_by_message_ids ────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_draft_attachments_by_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg3 = Uuid::parse_str("ee000003-0000-0000-0000-000000000003")?;
    let drafts = repo.draft_attachments_by_message_ids(&[msg3]).await?;

    let msg3_drafts = drafts
        .get(&msg3)
        .expect("msg3 should have draft attachments");
    assert_eq!(msg3_drafts.len(), 2, "msg3 has 2 draft attachments");

    // Ordered by file_name ASC: alpha.txt < beta.docx
    assert_eq!(msg3_drafts[0].file_name, "alpha.txt");
    assert_eq!(msg3_drafts[0].content_type, "text/plain");
    assert_eq!(msg3_drafts[0].sha, "sha256-aaa");
    assert_eq!(msg3_drafts[0].size, 100);
    assert_eq!(msg3_drafts[0].s3_key, "s3://bucket/alpha.txt");
    assert_eq!(msg3_drafts[0].draft_id, msg3);

    assert_eq!(msg3_drafts[1].file_name, "beta.docx");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_draft_attachments_by_message_ids_no_drafts(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // msg1 is not a draft, has no draft attachments
    let msg1 = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let drafts = repo.draft_attachments_by_message_ids(&[msg1]).await?;

    assert!(drafts.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_draft_attachments_by_message_ids_empty_input(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let drafts = repo.draft_attachments_by_message_ids(&[]).await?;
    assert!(drafts.is_empty());

    Ok(())
}

// ── forwarded_attachments_by_message_ids ────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_forwarded_attachments_by_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg3 = Uuid::parse_str("ee000003-0000-0000-0000-000000000003")?;
    let forwarded = repo.forwarded_attachments_by_message_ids(&[msg3]).await?;

    let msg3_fwd = forwarded
        .get(&msg3)
        .expect("msg3 should have forwarded attachments");
    assert_eq!(msg3_fwd.len(), 1, "msg3 forwards 1 attachment from msg1");

    let fwd = &msg3_fwd[0];
    assert_eq!(
        fwd.attachment_id,
        Uuid::parse_str("aa000001-0000-0000-0000-000000000001")?
    );
    assert_eq!(fwd.draft_id, msg3);
    assert_eq!(fwd.provider_attachment_id.as_deref(), Some("prov-att-1"));
    // message_provider_id comes from the original message (msg1)
    assert_eq!(fwd.message_provider_id, "provider-msg-1");
    assert_eq!(fwd.filename.as_deref(), Some("document.pdf"));
    assert_eq!(fwd.mime_type.as_deref(), Some("application/pdf"));
    assert_eq!(fwd.size_bytes, Some(102400));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_forwarded_attachments_by_message_ids_empty_input(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let forwarded = repo.forwarded_attachments_by_message_ids(&[]).await?;
    assert!(forwarded.is_empty());

    Ok(())
}

// ── scheduled_send_times_by_message_ids ─────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_scheduled_send_times_by_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let msg3 = Uuid::parse_str("ee000003-0000-0000-0000-000000000003")?;
    let times = repo.scheduled_send_times_by_message_ids(&[msg3]).await?;

    assert_eq!(times.len(), 1, "msg3 has a pending scheduled send");
    let send_time = times.get(&msg3).expect("msg3 should have a send time");
    assert_eq!(
        send_time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "2025-03-01T09:00:00Z"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_scheduled_send_times_excludes_already_sent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // msg2 has a scheduled send but sent=true
    let msg2 = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let times = repo.scheduled_send_times_by_message_ids(&[msg2]).await?;

    assert!(
        times.is_empty(),
        "Already-sent scheduled messages should be excluded"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn test_scheduled_send_times_by_message_ids_empty_input(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let times = repo.scheduled_send_times_by_message_ids(&[]).await?;
    assert!(times.is_empty());

    Ok(())
}

// ── process_scheduled_message ──────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_process_scheduled_message_insert(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    // Truncate to microseconds — Postgres TIMESTAMPTZ only stores microsecond precision
    let send_time = {
        let t = chrono::Utc::now() + chrono::Duration::hours(1);
        t.with_nanosecond(t.nanosecond() / 1000 * 1000).unwrap()
    };

    let mut tx = pool.begin().await?;
    super::super::message::process_scheduled_message(&mut *tx, link_id, msg_id, Some(send_time))
        .await?;
    tx.commit().await?;

    let row = sqlx::query(
        "SELECT send_time, sent FROM email_scheduled_messages WHERE link_id = $1 AND message_id = $2",
    )
    .bind(link_id)
    .bind(msg_id)
    .fetch_one(&pool)
    .await?;

    let stored_time = row.get::<chrono::DateTime<chrono::Utc>, _>("send_time");
    let sent = row.get::<bool, _>("sent");
    assert_eq!(stored_time, send_time);
    assert!(!sent);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_process_scheduled_message_upsert(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    // Truncate to microseconds — Postgres TIMESTAMPTZ only stores microsecond precision
    let trunc =
        |t: chrono::DateTime<chrono::Utc>| t.with_nanosecond(t.nanosecond() / 1000 * 1000).unwrap();
    let send_time1 = trunc(chrono::Utc::now() + chrono::Duration::hours(1));
    let send_time2 = trunc(chrono::Utc::now() + chrono::Duration::hours(2));

    // Insert first
    let mut tx = pool.begin().await?;
    super::super::message::process_scheduled_message(&mut *tx, link_id, msg_id, Some(send_time1))
        .await?;
    tx.commit().await?;

    // Upsert with new time
    let mut tx = pool.begin().await?;
    super::super::message::process_scheduled_message(&mut *tx, link_id, msg_id, Some(send_time2))
        .await?;
    tx.commit().await?;

    let row = sqlx::query(
        "SELECT send_time FROM email_scheduled_messages WHERE link_id = $1 AND message_id = $2",
    )
    .bind(link_id)
    .bind(msg_id)
    .fetch_one(&pool)
    .await?;

    let stored_time = row.get::<chrono::DateTime<chrono::Utc>, _>("send_time");
    assert_eq!(stored_time, send_time2, "Send time should be updated");

    // Still only one row
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_scheduled_messages WHERE link_id = $1 AND message_id = $2",
    )
    .bind(link_id)
    .bind(msg_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_process_scheduled_message_delete(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let send_time = chrono::Utc::now() + chrono::Duration::hours(1);

    // Insert first
    let mut tx = pool.begin().await?;
    super::super::message::process_scheduled_message(&mut *tx, link_id, msg_id, Some(send_time))
        .await?;
    tx.commit().await?;

    // Delete by passing None
    let mut tx = pool.begin().await?;
    super::super::message::process_scheduled_message(&mut *tx, link_id, msg_id, None).await?;
    tx.commit().await?;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_scheduled_messages WHERE link_id = $1 AND message_id = $2",
    )
    .bind(link_id)
    .bind(msg_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 0, "Scheduled message should be deleted");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_process_scheduled_message_delete_nonexistent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;

    // Delete when nothing exists — should not error
    let mut tx = pool.begin().await?;
    super::super::message::process_scheduled_message(&mut *tx, link_id, msg_id, None).await?;
    tx.commit().await?;

    Ok(())
}

// ── upsert_recipients ──────────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_recipients_insert(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // msg2 (draft) currently has no recipients in the fixture
    let msg_id = Uuid::parse_str("ee000002-0000-0000-0000-000000000002")?;
    let bob_id = Uuid::parse_str("c0000002-0000-0000-0000-000000000002")?;
    let carol_id = Uuid::parse_str("c0000003-0000-0000-0000-000000000003")?;

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![
            UpsertedRecipient {
                contact_id: bob_id,
                name: Some("Bob Jones".to_string()),
                recipient_type: RecipientType::To,
            },
            UpsertedRecipient {
                contact_id: carol_id,
                name: None,
                recipient_type: RecipientType::Cc,
            },
        ],
    };

    let mut tx = pool.begin().await?;
    super::super::message::upsert_recipients(&mut *tx, msg_id, &contacts).await?;
    tx.commit().await?;

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_message_recipients WHERE message_id = $1")
            .bind(msg_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(count, 2, "Should have 2 recipients");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_recipients_removes_stale(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // msg1 has bob=TO in the fixture. Replace with carol=CC.
    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;
    let carol_id = Uuid::parse_str("c0000003-0000-0000-0000-000000000003")?;

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![UpsertedRecipient {
            contact_id: carol_id,
            name: None,
            recipient_type: RecipientType::Cc,
        }],
    };

    let mut tx = pool.begin().await?;
    super::super::message::upsert_recipients(&mut *tx, msg_id, &contacts).await?;
    tx.commit().await?;

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_message_recipients WHERE message_id = $1")
            .bind(msg_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        count, 1,
        "Stale recipient should be removed, only carol remains"
    );

    let row = sqlx::query(
        "SELECT contact_id, recipient_type::text FROM email_message_recipients WHERE message_id = $1",
    )
    .bind(msg_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.get::<Uuid, _>("contact_id"), carol_id);
    assert_eq!(row.get::<String, _>("recipient_type"), "CC");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn test_upsert_recipients_empty_deletes_all(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // msg1 has bob=TO. Calling upsert with empty recipients should delete all existing.
    let msg_id = Uuid::parse_str("ee000001-0000-0000-0000-000000000001")?;

    let contacts = UpsertedContacts {
        from_contact_id: None,
        recipients: vec![],
    };

    let mut tx = pool.begin().await?;
    super::super::message::upsert_recipients(&mut *tx, msg_id, &contacts).await?;
    tx.commit().await?;

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM email_message_recipients WHERE message_id = $1")
            .bind(msg_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(
        count, 0,
        "Empty recipients should delete all existing recipients"
    );

    Ok(())
}
