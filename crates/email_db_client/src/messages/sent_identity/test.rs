use super::reconcile_message;
use crate::messages::scheduled::delivery;
use crate::messages::update::mark_message_as_sent;
use crate::threads::provider_identity::{lock_provider_thread, reconcile_sent_thread};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{PgPool, types::Uuid};

const LINK: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000001);
const THREAD: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000101);
const PROVIDER_THREAD: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000102);
const MESSAGE: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000201);
const IMPORTED: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000202);
const ATTACHMENT: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000401);
const CONTACT: Uuid = Uuid::from_u128(0x019a0000_0000_7000_8000_000000000301);

async fn imported_delivery(pool: &PgPool) -> anyhow::Result<delivery::DeliveryClaim> {
    sqlx::query!(
        "INSERT INTO email_scheduled_messages (link_id, message_id, send_time) VALUES ($1, $2, NOW() - INTERVAL '1 second')",
        LINK, MESSAGE,
    ).execute(pool).await?;
    let claim = delivery::claim_delivery(pool, LINK, MESSAGE, 300)
        .await?
        .unwrap();
    assert!(delivery::begin_submission(pool, &claim, 300).await?);
    sqlx::query!(
        r#"INSERT INTO email_send_attempts (user_id, link_id, attempt_id, message_id, thread_id)
           VALUES ('macro|sent-cache@example.com', $1, $2, $2, $3)"#,
        LINK,
        MESSAGE,
        THREAD,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "UPDATE email_threads SET provider_id = 'sent-provider-thread' WHERE id = $1",
        PROVIDER_THREAD,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"UPDATE email_messages SET provider_id = 'sent-provider-message',
           provider_thread_id = 'sent-provider-thread', is_sent = TRUE,
           global_id = $2, headers_jsonb = '{"received":"headers"}', is_starred = TRUE,
           has_attachments = TRUE WHERE id = $1"#,
        IMPORTED,
        claim.message_id_header,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename) VALUES ($1, $2, 'attachment', 'event.ics')",
        ATTACHMENT, IMPORTED,
    ).execute(pool).await?;
    sqlx::query!(
        "INSERT INTO email_attachments_fwd (message_id, attachment_id) VALUES ($1, $2)",
        MESSAGE,
        ATTACHMENT,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name) VALUES ($1, $2, 'TO', 'Provider recipient')",
        IMPORTED, CONTACT,
    ).execute(pool).await?;
    sqlx::query!(
        "INSERT INTO email_message_calendar_invites (message_id, component_id, snapshot) VALUES ($1, 'invitation', '{}')",
        IMPORTED,
    ).execute(pool).await?;
    Ok(claim)
}

async fn complete(pool: &PgPool, claim: &delivery::DeliveryClaim) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    lock_provider_thread(&mut tx, LINK, "sent-provider-thread").await?;
    if !delivery::complete_delivery(&mut tx, claim).await? {
        return Ok(false);
    }
    reconcile_message(&mut tx, LINK, MESSAGE, "sent-provider-message").await?;
    let thread = reconcile_sent_thread(&mut tx, LINK, MESSAGE, "sent-provider-thread").await?;
    mark_message_as_sent(
        &mut tx,
        "sent-provider-message",
        "sent-provider-thread",
        LINK,
        MESSAGE,
    )
    .await?;
    crate::threads::update::update_thread_metadata(&mut tx, thread, LINK).await?;
    crate::threads::update::sync_thread_calendar_flag(&mut tx, thread).await?;
    tx.commit().await?;
    Ok(true)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn sync_before_completion_preserves_original_message_and_imported_dependents(
    pool: PgPool,
) -> anyhow::Result<()> {
    let claim = imported_delivery(&pool).await?;
    let reply = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO email_messages (id, link_id, thread_id, replying_to_id) VALUES ($1, $2, $3, $4)",
        reply, LINK, THREAD, IMPORTED,
    ).execute(&pool).await?;
    assert!(complete(&pool, &claim).await?);
    let message = sqlx::query!(
        r#"SELECT id, thread_id, is_sent, internal_date_ts, is_starred, has_attachments
           FROM email_messages WHERE link_id = $1 AND provider_id = 'sent-provider-message'"#,
        LINK,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(message.id, MESSAGE);
    assert_eq!(message.thread_id, PROVIDER_THREAD);
    assert!(message.is_sent && message.is_starred && message.has_attachments);
    assert_eq!(
        message.internal_date_ts.unwrap().to_rfc3339(),
        "2025-01-01T12:00:00+00:00"
    );
    let attachment = sqlx::query!(
        r#"SELECT a.message_id, f.message_id AS forwarded_by
           FROM email_attachments a JOIN email_attachments_fwd f ON f.attachment_id = a.id
           WHERE a.id = $1"#,
        ATTACHMENT,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(attachment.message_id, MESSAGE);
    assert_eq!(attachment.forwarded_by, MESSAGE);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT replying_to_id FROM email_messages WHERE id = $1",
            reply
        )
        .fetch_one(&pool)
        .await?,
        Some(MESSAGE)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT name FROM email_message_recipients WHERE message_id = $1 AND contact_id = $2",
            MESSAGE,
            CONTACT,
        )
        .fetch_one(&pool)
        .await?
        .as_deref(),
        Some("Provider recipient"),
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT component_id FROM email_message_calendar_invites WHERE message_id = $1",
            MESSAGE,
        )
        .fetch_one(&pool)
        .await?,
        "invitation",
    );
    assert!(!complete(&pool, &claim).await?);
    assert!(
        sqlx::query_scalar!(
            "SELECT thread_id FROM email_thread_client_ids WHERE link_id = $1 AND client_id = $2",
            LINK,
            THREAD,
        )
        .fetch_optional(&pool)
        .await?
        .is_none(),
        "A thread retaining other messages must not redirect",
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn empty_original_thread_retains_row_and_redirects_all_its_aliases(
    pool: PgPool,
) -> anyhow::Result<()> {
    let claim = imported_delivery(&pool).await?;
    let client_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO email_thread_client_ids (client_id, link_id, thread_id) VALUES ($1, $2, $3)",
        client_id,
        LINK,
        THREAD,
    )
    .execute(&pool)
    .await?;
    assert!(complete(&pool, &claim).await?);
    let aliases = sqlx::query_scalar!(
        "SELECT thread_id FROM email_thread_client_ids WHERE link_id = $1 AND client_id = ANY($2)",
        LINK,
        &[client_id, THREAD],
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(aliases, vec![PROVIDER_THREAD, PROVIDER_THREAD]);
    let original = sqlx::query!(
        "SELECT inbox_visible, latest_outbound_message_ts FROM email_threads WHERE id = $1",
        THREAD,
    )
    .fetch_one(&pool)
    .await?;
    assert!(!original.inbox_visible);
    assert!(original.latest_outbound_message_ts.is_none());
    assert!(
        sqlx::query_scalar!(
            "SELECT has_calendar_attachment FROM email_threads WHERE id = $1",
            PROVIDER_THREAD,
        )
        .fetch_one(&pool)
        .await?
    );
    let attempt = sqlx::query!(
        "SELECT message_id, thread_id, sent FROM email_send_attempts WHERE link_id = $1 AND attempt_id = $2",
        LINK, MESSAGE,
    ).fetch_one(&pool).await?;
    assert_eq!(attempt.message_id, Some(MESSAGE));
    assert_eq!(attempt.thread_id, Some(PROVIDER_THREAD));
    assert!(attempt.sent);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn duplicate_attachment_references_survive_reconciliation(
    pool: PgPool,
) -> anyhow::Result<()> {
    let claim = imported_delivery(&pool).await?;
    let duplicate = macro_uuid::generate_uuid_v7();
    let sfs = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO email_attachments (id, message_id, provider_attachment_id) VALUES ($1, $2, 'attachment')",
        duplicate, MESSAGE,
    ).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id) VALUES ($1, $2, $1)",
        sfs,
        duplicate,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'delivery-user', 'sent-cache@example.com', 'cus_delivery_test')",
        sfs,
    ).execute(&pool).await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           VALUES ('macro|sent-cache@example.com', 'sent-cache@example.com', $1)"#,
        sfs,
    )
    .execute(&pool)
    .await?;
    let document = duplicate.to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType", uploaded)
           VALUES ($1, 'attached.pdf', 'macro|sent-cache@example.com', 'pdf', TRUE)"#,
        document,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)",
        document,
        duplicate,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_attachments_fwd (message_id, attachment_id) VALUES ($1, $2)",
        MESSAGE,
        duplicate,
    )
    .execute(&pool)
    .await?;
    assert!(complete(&pool, &claim).await?);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT attachment_id FROM email_attachments_sfs WHERE id = $1",
            sfs
        )
        .fetch_one(&pool)
        .await?,
        Some(ATTACHMENT),
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT attachment_id FROM email_attachments_fwd WHERE message_id = $1",
            MESSAGE
        )
        .fetch_all(&pool)
        .await?,
        vec![ATTACHMENT],
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT email_attachment_id FROM document_email WHERE document_id = $1",
            document,
        )
        .fetch_one(&pool)
        .await?,
        ATTACHMENT,
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn concurrent_reconciliation_completes_once(pool: PgPool) -> anyhow::Result<()> {
    let claim = imported_delivery(&pool).await?;
    let (first, second) = tokio::join!(complete(&pool, &claim), complete(&pool, &claim));
    assert_ne!(first?, second?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn inbox_thread_sync_and_completion_converge_on_original_message(
    pool: PgPool,
) -> anyhow::Result<()> {
    let claim = imported_delivery(&pool).await?;
    let mut provider_thread =
        crate::threads::get::get_thread_by_id_and_link_id(&pool, PROVIDER_THREAD, LINK)
            .await?
            .unwrap();
    provider_thread.messages =
        crate::messages::get::fetch_messages_metadata(&mut *pool.acquire().await?, PROVIDER_THREAD)
            .await?;
    let (completed, synced_thread) = tokio::join!(
        complete(&pool, &claim),
        crate::threads::insert::insert_thread_and_messages(&pool, provider_thread, LINK),
    );
    assert!(completed?);
    assert_eq!(synced_thread?, PROVIDER_THREAD);
    let surviving = sqlx::query!(
        "SELECT id, thread_id FROM email_messages WHERE link_id = $1 AND provider_id = 'sent-provider-message'",
        LINK,
    ).fetch_one(&pool).await?;
    assert_eq!(surviving.id, MESSAGE);
    assert_eq!(surviving.thread_id, PROVIDER_THREAD);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("mark_message_as_sent"))
)]
async fn failed_completion_rolls_back_adoption(pool: PgPool) -> anyhow::Result<()> {
    let claim = imported_delivery(&pool).await?;
    let mut tx = pool.begin().await?;
    lock_provider_thread(&mut tx, LINK, "sent-provider-thread").await?;
    assert!(delivery::complete_delivery(&mut tx, &claim).await?);
    reconcile_message(&mut tx, LINK, MESSAGE, "sent-provider-message").await?;
    tx.rollback().await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT message_id FROM email_attachments WHERE id = $1",
            ATTACHMENT
        )
        .fetch_one(&pool)
        .await?,
        IMPORTED,
    );
    assert!(complete(&pool, &claim).await?);
    Ok(())
}
