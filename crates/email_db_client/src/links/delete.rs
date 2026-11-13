//! Transaction-scoped SQL facts and effects for the email domain's mailbox purge.

use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, Transaction};
use std::num::NonZeroU32;

/// One message selected in the original thread-ordered purge scan.
pub struct PurgeMessageRow {
    /// Stored message identity.
    pub id: Uuid,
    /// Thread identity used by the domain's batch cursor and finished-thread rule.
    pub thread_id: Uuid,
}

/// One contact selected in the original address-ordered purge scan.
pub struct PurgeContactRow {
    /// Stored contact identity.
    pub id: Uuid,
    /// Address used by the domain's next-batch cursor.
    pub email_address: String,
}

/// Marks a link as being deleted and stops its sync. A marked link never resumes syncing:
/// re-enabling sync and reconnecting the same mailbox both refuse it until the purge has
/// removed the row.
///
/// Idempotent and cheap to repeat: an already-marked link keeps its original `deleting_at`
/// and the row is not rewritten. A no-op for a missing link.
#[tracing::instrument(skip(pool), err)]
pub async fn mark_link_deleting(pool: &PgPool, link_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_links
        SET deleting_at = COALESCE(deleting_at, NOW()),
            is_sync_active = false,
            updated_at = NOW()
        WHERE id = $1 AND (deleting_at IS NULL OR is_sync_active)
        "#,
        link_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Opens a purge batch transaction holding the link's purge lock until commit, so a
/// redelivered delete running alongside the original takes turns batch by batch instead
/// of deadlocking on the rows both are deleting.
pub async fn begin_purge_batch(
    pool: &PgPool,
    link_id: Uuid,
) -> anyhow::Result<Transaction<'static, Postgres>> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('email_link_purge:' || $1::uuid::text, 0))",
        link_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(tx)
}

/// Bytes of WAL the server has generated so far, for pacing the purge by WAL rate.
pub async fn current_wal_position(pool: &PgPool) -> anyhow::Result<u64> {
    let position = sqlx::query_scalar!(
        r#"SELECT (pg_current_wal_lsn() - '0/0'::pg_lsn)::bigint AS "position!""#
    )
    .fetch_one(pool)
    .await?;
    Ok(u64::try_from(position)?)
}

/// Read a bounded batch in the existing thread order.
pub async fn select_purge_messages(
    tx: &mut Transaction<'static, Postgres>,
    link_id: Uuid,
    thread_cursor: Uuid,
    limit: NonZeroU32,
) -> anyhow::Result<Vec<PurgeMessageRow>> {
    let rows = sqlx::query!(
        r#"
        SELECT id, thread_id FROM email_messages
        WHERE link_id = $1 AND thread_id >= $2
        ORDER BY thread_id
        LIMIT $3
        "#,
        link_id,
        thread_cursor,
        i64::from(limit.get())
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| PurgeMessageRow {
            id: row.id,
            thread_id: row.thread_id,
        })
        .collect())
}

/// Delete labels belonging to the selected messages.
pub async fn delete_message_labels(
    tx: &mut Transaction<'static, Postgres>,
    message_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_message_labels WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Delete recipients belonging to the selected messages.
pub async fn delete_message_recipients(
    tx: &mut Transaction<'static, Postgres>,
    message_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_message_recipients WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Leave selected SFS rows detached for the storage cleanup worker.
pub async fn detach_message_files(
    tx: &mut Transaction<'static, Postgres>,
    message_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        r#"
        UPDATE email_attachments_sfs
        SET attachment_id = NULL
        WHERE attachment_id IN (SELECT id FROM email_attachments WHERE message_id = ANY($1))
        "#,
        &message_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Delete attachment rows belonging to the selected messages.
pub async fn delete_message_attachments(
    tx: &mut Transaction<'static, Postgres>,
    message_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_attachments WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Delete schedules belonging to the selected messages.
pub async fn delete_scheduled_messages(
    tx: &mut Transaction<'static, Postgres>,
    message_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Delete the selected message rows and return the affected count.
pub async fn delete_message_rows(
    tx: &mut Transaction<'static, Postgres>,
    message_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_messages WHERE id = ANY($1)",
        &message_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Delete history for the selected threads of this link.
pub async fn delete_thread_history(
    tx: &mut Transaction<'static, Postgres>,
    link_id: Uuid,
    thread_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_user_history WHERE link_id = $1 AND thread_id = ANY($2)",
        link_id,
        thread_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Delete the selected threads of this link and return the affected count.
pub async fn delete_thread_rows(
    tx: &mut Transaction<'static, Postgres>,
    link_id: Uuid,
    thread_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_threads WHERE link_id = $1 AND id = ANY($2)",
        link_id,
        thread_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Read a bounded batch of remaining threads without adding an ordering.
pub async fn select_purge_threads(
    tx: &mut Transaction<'static, Postgres>,
    link_id: Uuid,
    limit: NonZeroU32,
) -> anyhow::Result<Vec<Uuid>> {
    Ok(sqlx::query_scalar!(
        "SELECT id FROM email_threads WHERE link_id = $1 LIMIT $2",
        link_id,
        i64::from(limit.get())
    )
    .fetch_all(&mut **tx)
    .await?)
}

/// Read a bounded batch in the existing address order.
pub async fn select_purge_contacts(
    tx: &mut Transaction<'static, Postgres>,
    link_id: Uuid,
    email_cursor: &str,
    limit: NonZeroU32,
) -> anyhow::Result<Vec<PurgeContactRow>> {
    let rows = sqlx::query!(
        r#"
        SELECT id, email_address FROM email_contacts
        WHERE link_id = $1 AND email_address >= $2
        ORDER BY email_address
        LIMIT $3
        "#,
        link_id,
        email_cursor,
        i64::from(limit.get())
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| PurgeContactRow {
            id: row.id,
            email_address: row.email_address,
        })
        .collect())
}

/// Delete the selected contacts and return the affected count.
pub async fn delete_contact_rows(
    tx: &mut Transaction<'static, Postgres>,
    contact_ids: &[Uuid],
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_contacts WHERE id = ANY($1)",
        &contact_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Delete only the requested, marked link and return the affected count.
pub async fn delete_marked_link(
    tx: &mut Transaction<'static, Postgres>,
    link_id: Uuid,
) -> anyhow::Result<u64> {
    Ok(sqlx::query!(
        "DELETE FROM email_links WHERE id = $1 AND deleting_at IS NOT NULL",
        link_id
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}
