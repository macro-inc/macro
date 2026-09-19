use super::*;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::attachment::Attachment;
use sqlx::{Pool, Postgres};

const LINK_ID: &str = "00000000-0000-0000-0000-000000000001";
const THREAD_ID: &str = "10000000-0000-0000-0000-000000000001";

/// The Apple Mail one-click-unsubscribe address that wedged mwatts42's
/// backfill: 505 characters, well past `email_contacts.email_address`.
fn unsubscribe_address() -> String {
    let address = format!(
        "v3_{}@unsubscribe-06.emailinboundprocessing.com",
        "t".repeat(460)
    );
    assert_eq!(address.chars().count(), 505);
    address
}

fn message_with_oversized_fields(link_id: Uuid, thread_db_id: Uuid) -> message::Message {
    let now = Utc::now();
    message::Message {
        db_id: Uuid::now_v7(),
        provider_id: Some("oversized-recipient-message".to_string()),
        thread_db_id,
        provider_thread_id: Some("prov1".to_string()),
        replying_to_id: None,
        global_id: Some("<oversized@macro.com>".to_string()),
        link_id,
        subject: Some("unsubscribe".to_string()),
        snippet: None,
        provider_history_id: None,
        internal_date_ts: Some(now),
        sent_at: Some(now),
        size_estimate: Some(1024),
        is_read: true,
        is_starred: false,
        is_sent: true,
        is_draft: false,
        scheduled_send_time: None,
        has_attachments: true,
        from: Some(ContactInfo {
            email: "user1@macro.com".to_string(),
            name: Some("f".repeat(400)),
            photo_url: None,
        }),
        to: vec![
            ContactInfo {
                email: unsubscribe_address(),
                name: None,
                photo_url: None,
            },
            ContactInfo {
                email: "recipient@macro.com".to_string(),
                name: Some("n".repeat(400)),
                photo_url: None,
            },
        ],
        cc: vec![],
        bcc: vec![],
        labels: vec![],
        body_text: Some("body".to_string()),
        body_html_sanitized: Some("<p>body</p>".to_string()),
        body_macro: None,
        attachments: vec![Attachment {
            db_id: Uuid::now_v7(),
            provider_id: Some("att1".to_string()),
            data_url: None,
            filename: Some("report.PDF".to_string()),
            mime_type: Some("m".repeat(400)),
            size_bytes: Some(10),
            sfs_id: None,
            content_id: Some("c".repeat(400)),
        }],
        attachments_draft: vec![],
        attachments_forwarded: vec![],
        headers_json: None,
        created_at: now,
        updated_at: now,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn oversized_provider_values_do_not_block_the_message_insert(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str(LINK_ID)?;
    let thread_db_id = Uuid::parse_str(THREAD_ID)?;
    let mut message = message_with_oversized_fields(link_id, thread_db_id);
    let message_db_id = message.db_id;

    insert_message(&pool, thread_db_id, &mut message, link_id, false).await?;

    let inserted = sqlx::query!(
        r#"SELECT from_name FROM email_messages WHERE id = $1"#,
        message_db_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        inserted.from_name.as_deref().map(|n| n.chars().count()),
        Some(255)
    );

    // The unstorable address is dropped; every other recipient still lands.
    let recipients = sqlx::query!(
        r#"
        SELECT c.email_address, r.name
        FROM email_message_recipients r
        JOIN email_contacts c ON c.id = r.contact_id
        WHERE r.message_id = $1
        "#,
        message_db_id
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(recipients.len(), 1);
    assert_eq!(recipients[0].email_address, "recipient@macro.com");
    assert_eq!(
        recipients[0].name.as_deref().map(|n| n.chars().count()),
        Some(255)
    );

    let contacts = sqlx::query_scalar!(
        r#"SELECT email_address FROM email_contacts WHERE link_id = $1 ORDER BY email_address"#,
        link_id
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(contacts, vec!["recipient@macro.com", "user1@macro.com"]);

    let attachment = sqlx::query!(
        r#"
        SELECT mime_type, content_id
        FROM email_attachments
        WHERE message_id = $1
        "#,
        message_db_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        attachment.mime_type.as_deref().map(|m| m.chars().count()),
        Some(255)
    );
    assert_eq!(
        attachment.content_id.as_deref().map(|c| c.chars().count()),
        Some(255)
    );

    Ok(())
}
