use crate::domain::scheduled_delivery::deletion::{MessageDeletion, delete_message_with_tx};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("sync_thread_calendar_flag")
    )
)]
async fn delete_message_clears_calendar_flag_when_last_ics_message_removed(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-00000000b201")?;
    let ics_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000b501")?;
    let fusionauth_user_id = "00000000-0000-0000-0000-000000000b01";

    // Establish the flag from the fixture's .ics attachment.
    let mut conn = pool.acquire().await?;
    email_db_client::threads::update::sync_thread_attachment_flags(&mut conn, thread_id).await?;
    drop(conn);
    assert!(fetch_calendar_flag(&pool, thread_id).await?);

    let message = email_db_client::messages::get_simple_messages::get_simple_message(
        &pool,
        &ics_message_id,
        fusionauth_user_id,
    )
    .await?
    .expect("fixture message present");

    let mut tx = pool.begin().await?;
    let deletion = delete_message_with_tx(&mut *tx, &message).await?;
    tx.commit().await?;

    // The thread survives (a second message remains) and the flag flips off
    // because its attachments cascaded away with the message.
    assert_eq!(
        deletion,
        MessageDeletion::Deleted {
            deleted_thread: None
        }
    );
    assert!(!fetch_calendar_flag(&pool, thread_id).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("sync_thread_attachment_kind_flags")
    )
)]
async fn delete_message_clears_kind_flags_of_its_attachments(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-00000000c201")?;
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000c501")?;

    let mut conn = pool.acquire().await?;
    email_db_client::threads::update::sync_thread_attachment_flags(&mut conn, thread_id).await?;
    drop(conn);

    let message = email_db_client::messages::get_simple_messages::get_simple_message(
        &pool,
        &message_id,
        "00000000-0000-0000-0000-000000000c01",
    )
    .await?
    .expect("fixture message present");
    let mut tx = pool.begin().await?;
    delete_message_with_tx(&mut *tx, &message).await?;
    tx.commit().await?;

    // The PDF and PNG left with the message; the other message's .docx stays.
    let flags = sqlx::query!(
        "SELECT has_pdf_attachment, has_image_attachment, has_document_attachment
         FROM email_threads WHERE id = $1",
        thread_id
    )
    .fetch_one(&pool)
    .await?;
    assert!(!flags.has_pdf_attachment);
    assert!(!flags.has_image_attachment);
    assert!(flags.has_document_attachment);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("sync_thread_calendar_flag")
    )
)]
async fn delete_message_reports_already_deleted_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let ics_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000b501")?;
    let fusionauth_user_id = "00000000-0000-0000-0000-000000000b01";

    let message = email_db_client::messages::get_simple_messages::get_simple_message(
        &pool,
        &ics_message_id,
        fusionauth_user_id,
    )
    .await?
    .expect("fixture message present");

    let mut conn = pool.acquire().await?;
    let first = delete_message_with_tx(&mut *conn, &message).await?;
    let second = delete_message_with_tx(&mut *conn, &message).await?;

    assert!(matches!(first, MessageDeletion::Deleted { .. }));
    assert_eq!(second, MessageDeletion::AlreadyDeleted);
    Ok(())
}

async fn fetch_calendar_flag(pool: &Pool<Postgres>, thread_id: Uuid) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT has_calendar_attachment FROM email_threads WHERE id = $1",
        thread_id
    )
    .fetch_one(pool)
    .await?)
}

// Discarding a draft via delete_message_with_tx — the drafts delete API
// path — must recompute the thread metadata the draft inflated: is_signal,
// inbox_visible, and latest_inbound_message_ts all count drafts, and stale
// values would strand the thread in inbox views (Signal) after the draft
// is gone.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../email_db_client/fixtures",
        scripts("sync_thread_signal_flag")
    )
)]
async fn draft_discard_recomputes_thread_metadata(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const THREAD: &str = "00000000-0000-0000-0000-00000000d208";
    const DRAFT_MSG: &str = "00000000-0000-0000-0000-00000000d510";

    // Draft-inflated fixture state: signal, inbox-visible, draft ts standing
    // in for the inbound timestamp.
    assert!(fetch_signal(&pool, THREAD).await?);
    let before = fetch_inbox_state(&pool, THREAD).await?;
    assert!(before.inbox_visible);
    assert!(before.latest_inbound_message_ts.is_some());

    let now = chrono::Utc::now();
    let draft = models_email::email::service::message::SimpleMessage {
        db_id: Uuid::parse_str(DRAFT_MSG)?,
        provider_id: None,
        thread_db_id: Uuid::parse_str(THREAD)?,
        provider_thread_id: None,
        replying_to_id: None,
        global_id: String::new(),
        link_id: Uuid::parse_str("00000000-0000-0000-0000-000000000d01")?,
        subject: None,
        snippet: None,
        from_contact_id: None,
        provider_history_id: None,
        internal_date_ts: None,
        sent_at: None,
        size_estimate: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: true,
        has_attachments: false,
        headers_json: None,
        created_at: now,
        updated_at: now,
    };

    let mut conn = pool.acquire().await?;
    let deletion = delete_message_with_tx(&mut *conn, &draft).await?;
    assert_eq!(
        deletion,
        MessageDeletion::Deleted {
            deleted_thread: None
        },
        "thread should survive"
    );

    // The remaining message is CATEGORY_PROMOTIONS-only: noise, and without
    // an INBOX label the thread leaves the inbox and has no inbound ts.
    assert!(!fetch_signal(&pool, THREAD).await?);
    let after = fetch_inbox_state(&pool, THREAD).await?;
    assert!(!after.inbox_visible);
    assert!(after.latest_inbound_message_ts.is_none());
    Ok(())
}

async fn fetch_signal(pool: &Pool<Postgres>, thread_id: &str) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        "SELECT is_signal FROM email_threads WHERE id = $1",
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

async fn fetch_inbox_state(
    pool: &Pool<Postgres>,
    thread_id: &str,
) -> anyhow::Result<ThreadInboxState> {
    Ok(sqlx::query_as!(
        ThreadInboxState,
        r#"SELECT inbox_visible, latest_inbound_message_ts FROM email_threads WHERE id = $1"#,
        Uuid::parse_str(thread_id)?
    )
    .fetch_one(pool)
    .await?)
}

struct ThreadInboxState {
    inbox_visible: bool,
    latest_inbound_message_ts: Option<chrono::DateTime<chrono::Utc>>,
}
