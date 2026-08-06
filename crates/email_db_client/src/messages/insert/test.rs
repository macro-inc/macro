use super::*;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

fn message(link_id: Uuid, thread_id: Uuid, message_id: Uuid) -> message::Message {
    message::Message {
        db_id: message_id,
        provider_id: Some("provider-message".to_string()),
        thread_db_id: thread_id,
        provider_thread_id: Some("prov1".to_string()),
        replying_to_id: None,
        global_id: None,
        link_id,
        subject: None,
        snippet: None,
        provider_history_id: None,
        internal_date_ts: None,
        sent_at: None,
        size_estimate: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: true,
        scheduled_send_time: None,
        has_attachments: false,
        from: None,
        to: Vec::new(),
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: Vec::new(),
        body_text: None,
        body_html_sanitized: None,
        body_macro: None,
        attachments: Vec::new(),
        attachments_draft: Vec::new(),
        attachments_forwarded: Vec::new(),
        headers_json: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("links", "threads"))
)]
async fn message_upsert_returns_committed_ids_and_insertion_status(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
    let thread_id = Uuid::parse_str("10000000-0000-0000-0000-000000000001")?;
    let inserted_id = Uuid::parse_str("20000000-0000-0000-0000-000000000001")?;
    let conflicting_id = Uuid::parse_str("20000000-0000-0000-0000-000000000002")?;
    let mut connection = pool.acquire().await?;

    let first = insert_db_message(
        &mut connection,
        &mut message(link_id, thread_id, inserted_id),
        thread_id,
        None,
        false,
    )
    .await?;
    let second = insert_db_message(
        &mut connection,
        &mut message(link_id, thread_id, conflicting_id),
        thread_id,
        None,
        false,
    )
    .await?;

    assert_eq!(
        first,
        MessageInsertionOutcome {
            message_id: inserted_id,
            thread_id,
            inserted: true,
        }
    );
    assert_eq!(
        second,
        MessageInsertionOutcome {
            message_id: inserted_id,
            thread_id,
            inserted: false,
        }
    );

    Ok(())
}
