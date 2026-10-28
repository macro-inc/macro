use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, Transaction};
use std::num::NonZeroU32;

#[cfg(test)]
mod test;

/// How many rows each [`purge_link`] transaction removes. Every batch commits on its own,
/// so no single transaction holds locks, WAL or the xmin horizon for a whole mailbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PurgeBatchSizes {
    /// Messages per transaction, deleted together with their labels, recipients,
    /// attachments and scheduled sends, and with the threads the batch finishes. Message
    /// bodies are most of a mailbox's bytes (TOAST), so this is the knob that bounds a
    /// transaction's WAL.
    pub messages: NonZeroU32,
    /// Threads per transaction for threads left once every message is gone.
    pub threads: NonZeroU32,
    /// Contacts per transaction.
    pub contacts: NonZeroU32,
}

impl Default for PurgeBatchSizes {
    fn default() -> Self {
        Self {
            messages: NonZeroU32::new(1_000).expect("non-zero"),
            threads: NonZeroU32::new(2_000).expect("non-zero"),
            contacts: NonZeroU32::new(5_000).expect("non-zero"),
        }
    }
}

/// Rows removed by one [`purge_link`] call. A rerun reports only what it removed itself.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PurgeSummary {
    /// Messages deleted.
    pub messages: u64,
    /// Threads deleted.
    pub threads: u64,
    /// Contacts deleted.
    pub contacts: u64,
    /// Whether this call deleted the `email_links` row; `false` when it was already gone.
    pub link_deleted: bool,
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

/// Deletes a link and all of its email data incrementally: messages (deepest children
/// first) with the threads they belong to, then any remaining threads, then contacts,
/// each in bounded short transactions, and finally the `email_links` row, whose cascade
/// only has small per-link tables left to clear.
///
/// Marks the link via [`mark_link_deleting`] first, so it can be called on its own. Safe to
/// rerun after a crash (it resumes from whatever is left) and to run concurrently for the
/// same link: batches for one link are serialized by an advisory lock.
#[tracing::instrument(skip(pool), err)]
pub async fn purge_link(
    pool: &PgPool,
    link_id: Uuid,
    batch_sizes: PurgeBatchSizes,
) -> anyhow::Result<PurgeSummary> {
    mark_link_deleting(pool, link_id).await?;

    let mut summary = PurgeSummary::default();

    let mut thread_cursor = Uuid::nil();
    loop {
        let batch = purge_message_batch(pool, link_id, thread_cursor, batch_sizes.messages).await?;
        summary.messages += batch.messages;
        summary.threads += batch.threads;
        let Some(next_cursor) = batch.next_cursor else {
            break;
        };
        thread_cursor = next_cursor;
    }

    loop {
        let batch = purge_thread_batch(pool, link_id, batch_sizes.threads).await?;
        summary.threads += batch.deleted;
        if !batch.full {
            break;
        }
    }

    let mut contact_cursor = String::new();
    loop {
        let batch =
            purge_contact_batch(pool, link_id, &contact_cursor, batch_sizes.contacts).await?;
        summary.contacts += batch.deleted;
        let Some(next_cursor) = batch.next_cursor else {
            break;
        };
        contact_cursor = next_cursor;
    }

    summary.link_deleted = delete_marked_link(pool, link_id).await?;

    tracing::info!(?summary, "Purged email link");
    Ok(summary)
}

/// Opens a purge batch transaction holding the link's purge lock until commit, so a
/// redelivered delete running alongside the original takes turns batch by batch instead
/// of deadlocking on the rows both are deleting.
async fn begin_purge_batch(
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

/// Outcome of one [`purge_message_batch`].
struct MessageBatch {
    messages: u64,
    threads: u64,
    /// Where the next batch starts; `None` once the batch came back short.
    next_cursor: Option<Uuid>,
}

/// Deletes up to `limit` of the link's messages with their children, deepest first,
/// walking messages in thread order from `thread_cursor`. Each batch starts at the last
/// thread the previous one touched, so it never rescans index entries of rows earlier
/// batches deleted (which stay in the index until vacuum, and stay unkillable while any
/// older snapshot is open). Threads whose messages the batch exhausted are deleted with it.
async fn purge_message_batch(
    pool: &PgPool,
    link_id: Uuid,
    thread_cursor: Uuid,
    limit: NonZeroU32,
) -> anyhow::Result<MessageBatch> {
    let mut tx = begin_purge_batch(pool, link_id).await?;

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
    .fetch_all(&mut *tx)
    .await?;

    let Some(last_thread_id) = rows.last().map(|row| row.thread_id) else {
        tx.commit().await?;
        return Ok(MessageBatch {
            messages: 0,
            threads: 0,
            next_cursor: None,
        });
    };
    let full = rows.len() as u64 == u64::from(limit.get());

    let message_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    // Rows come back in thread order, so every thread before the last one is exhausted.
    // The last thread may continue past this batch unless the batch came back short.
    let mut finished_thread_ids: Vec<Uuid> = rows
        .iter()
        .map(|row| row.thread_id)
        .filter(|thread_id| !full || *thread_id != last_thread_id)
        .collect();
    finished_thread_ids.dedup();

    sqlx::query!(
        "DELETE FROM email_message_labels WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!(
        "DELETE FROM email_message_recipients WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut *tx)
    .await?;

    // Detached rather than deleted: email_sfs_delete_handler removes the stored file for
    // every row whose attachment_id is NULL, then deletes the row itself.
    sqlx::query!(
        r#"
        UPDATE email_attachments_sfs
        SET attachment_id = NULL
        WHERE attachment_id IN (SELECT id FROM email_attachments WHERE message_id = ANY($1))
        "#,
        &message_ids
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!(
        "DELETE FROM email_attachments WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id = ANY($1)",
        &message_ids
    )
    .execute(&mut *tx)
    .await?;

    let messages = sqlx::query!(
        "DELETE FROM email_messages WHERE id = ANY($1)",
        &message_ids
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    let threads = delete_threads(&mut tx, link_id, &finished_thread_ids).await?;

    tx.commit().await?;
    Ok(MessageBatch {
        messages,
        threads,
        next_cursor: full.then_some(last_thread_id),
    })
}

/// Deletes the given threads of the link with their user history. Returns the number of
/// threads deleted.
async fn delete_threads(
    tx: &mut Transaction<'static, Postgres>,
    link_id: Uuid,
    thread_ids: &[Uuid],
) -> anyhow::Result<u64> {
    if thread_ids.is_empty() {
        return Ok(0);
    }

    sqlx::query!(
        "DELETE FROM email_user_history WHERE link_id = $1 AND thread_id = ANY($2)",
        link_id,
        thread_ids
    )
    .execute(&mut **tx)
    .await?;

    Ok(sqlx::query!(
        "DELETE FROM email_threads WHERE link_id = $1 AND id = ANY($2)",
        link_id,
        thread_ids
    )
    .execute(&mut **tx)
    .await?
    .rows_affected())
}

/// Outcome of one [`purge_thread_batch`].
struct ThreadBatch {
    deleted: u64,
    /// Whether the batch came back full, so more threads may remain.
    full: bool,
}

/// Deletes up to `limit` of the link's remaining threads. The message phase already
/// deleted every thread that had messages, so this only meets threads that never had any
/// and the last ones a straggling sync wrote mid-purge.
async fn purge_thread_batch(
    pool: &PgPool,
    link_id: Uuid,
    limit: NonZeroU32,
) -> anyhow::Result<ThreadBatch> {
    let mut tx = begin_purge_batch(pool, link_id).await?;

    let thread_ids = sqlx::query_scalar!(
        "SELECT id FROM email_threads WHERE link_id = $1 LIMIT $2",
        link_id,
        i64::from(limit.get())
    )
    .fetch_all(&mut *tx)
    .await?;

    let full = thread_ids.len() as u64 == u64::from(limit.get());
    let deleted = delete_threads(&mut tx, link_id, &thread_ids).await?;

    tx.commit().await?;
    Ok(ThreadBatch { deleted, full })
}

/// Outcome of one [`purge_contact_batch`].
struct ContactBatch {
    deleted: u64,
    /// Where the next batch starts; `None` once the batch came back short.
    next_cursor: Option<String>,
}

/// Deletes up to `limit` of the link's contacts, walking them in email address order from
/// `email_cursor` so no batch rescans rows an earlier one deleted.
async fn purge_contact_batch(
    pool: &PgPool,
    link_id: Uuid,
    email_cursor: &str,
    limit: NonZeroU32,
) -> anyhow::Result<ContactBatch> {
    let mut tx = begin_purge_batch(pool, link_id).await?;

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
    .fetch_all(&mut *tx)
    .await?;

    let full = rows.len() as u64 == u64::from(limit.get());
    let contact_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();

    let deleted = sqlx::query!(
        "DELETE FROM email_contacts WHERE id = ANY($1)",
        &contact_ids
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    tx.commit().await?;
    Ok(ContactBatch {
        deleted,
        next_cursor: full
            .then(|| rows.last().map(|row| row.email_address.clone()))
            .flatten(),
    })
}

/// Deletes the link row once its bulk data is gone. Only a link marked by
/// [`mark_link_deleting`] is deleted. Returns whether a row was deleted.
async fn delete_marked_link(pool: &PgPool, link_id: Uuid) -> anyhow::Result<bool> {
    let mut tx = begin_purge_batch(pool, link_id).await?;

    let deleted = sqlx::query!(
        "DELETE FROM email_links WHERE id = $1 AND deleting_at IS NOT NULL",
        link_id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    tx.commit().await?;
    Ok(deleted > 0)
}
