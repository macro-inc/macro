#[cfg(test)]
mod test;

use models_email::email::service::label::system_labels;
use sqlx::types::Uuid;
use sqlx::{Executor, PgConnection, Postgres};
use std::collections::HashMap;

/// Makes label writes that stage or undo a change on the same threads take
/// turns until the transaction ends, so each reads the state the one before
/// it left. Locks are taken in id order, so writers on several threads cannot
/// deadlock each other.
#[tracing::instrument(skip(tx, thread_ids), err)]
pub async fn lock_thread_label_writes(
    tx: &mut PgConnection,
    thread_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    let mut thread_ids = thread_ids.to_vec();
    thread_ids.sort_unstable();
    thread_ids.dedup();
    for thread_id in thread_ids {
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            format!("email_thread_label_write:{thread_id}"),
        )
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

/// Records that the Gmail operations sharing `write_id` will set
/// `provider_label_id` on `message_ids` of the link to `label_present`, each a
/// change from the opposite state, so inbox sync keeps the local label state
/// until Gmail confirms it. Rows stop applying after 12 hours, longer than an
/// operation is redelivered through the gmail_ops queues, so only operations
/// that are dead-lettered or lost fall back to Gmail's labels.
#[tracing::instrument(skip(executor, message_ids), err)]
pub async fn mark_pending_label_writes<'e, E>(
    executor: E,
    link_id: Uuid,
    message_ids: &[Uuid],
    provider_label_id: &str,
    label_present: bool,
    write_id: Uuid,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        INSERT INTO email_gmail_pending_label_writes
            (message_id, provider_label_id, write_id, label_present, label_present_before, expires_at)
        SELECT m.id, $3, $4, $5, NOT $5, now() + interval '12 hours'
        FROM email_messages m
        WHERE m.id = ANY($1) AND m.link_id = $2
        ORDER BY m.id
        ON CONFLICT (message_id, provider_label_id, write_id) DO NOTHING
        "#,
        message_ids,
        link_id,
        provider_label_id,
        write_id,
        label_present,
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// What a write's operation does with one of its messages now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LabelWriteTurn {
    /// The write is the newest on every label: send it to Gmail.
    Send,
    /// A newer write on the message is still on its way. Its outcome decides
    /// whether this one still has to send, so try again later.
    Wait,
    /// A newer write was confirmed, or gave up on waiting for this one:
    /// nothing left to send.
    Superseded,
}

/// The turn of `write_id` on each of `message_ids` for `provider_label_ids`.
/// A write waits for every newer write whose row hasn't expired, whatever its
/// id: requests can stage in another order than they drew their ids. Bulk
/// writes can each be the newer one on a different message, so an operation
/// sends the messages it is newest on before it waits for the rest.
#[tracing::instrument(skip(executor, message_ids), err)]
pub async fn label_write_turns<'e, E>(
    executor: E,
    message_ids: &[Uuid],
    provider_label_ids: &[String],
    write_id: Uuid,
) -> Result<HashMap<Uuid, LabelWriteTurn>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let rows = sqlx::query!(
        r#"
        SELECT
            m.id AS "message_id!",
            mine.seq IS NOT NULL AS "claimed!",
            EXISTS (
                SELECT 1 FROM email_gmail_pending_label_writes newer
                WHERE newer.message_id = m.id AND newer.provider_label_id = l.label
                    AND newer.seq > mine.seq
            ) AS "has_newer!",
            EXISTS (
                SELECT 1 FROM email_gmail_pending_label_writes newer
                WHERE newer.message_id = m.id AND newer.provider_label_id = l.label
                    AND newer.seq > mine.seq AND newer.expires_at > now()
            ) AS "waits!"
        FROM unnest($1::uuid[]) AS m(id)
        CROSS JOIN unnest($3::text[]) AS l(label)
        LEFT JOIN email_gmail_pending_label_writes mine
            ON mine.message_id = m.id AND mine.provider_label_id = l.label AND mine.write_id = $2
        "#,
        message_ids,
        write_id,
        provider_label_ids,
    )
    .fetch_all(executor)
    .await?;

    let mut turns = HashMap::new();
    for row in rows {
        let turn = if !row.claimed {
            LabelWriteTurn::Superseded
        } else if row.waits {
            LabelWriteTurn::Wait
        } else if row.has_newer {
            LabelWriteTurn::Superseded
        } else {
            LabelWriteTurn::Send
        };
        turns
            .entry(row.message_id)
            .and_modify(|current: &mut LabelWriteTurn| {
                *current = match (*current, turn) {
                    (LabelWriteTurn::Wait, _) | (_, LabelWriteTurn::Wait) => LabelWriteTurn::Wait,
                    (LabelWriteTurn::Send, LabelWriteTurn::Send) => LabelWriteTurn::Send,
                    _ => LabelWriteTurn::Superseded,
                }
            })
            .or_insert(turn);
    }
    Ok(turns)
}

/// Gmail applied `write_id` on `message_ids`: removes its rows and those of
/// every older write on the same labels, which Gmail no longer needs. A
/// newer write's row now falls back to this write's state. Callers hold
/// `lock_thread_label_writes` for the messages' threads.
#[tracing::instrument(skip(tx, message_ids), err)]
pub async fn confirm_pending_label_writes(
    tx: &mut PgConnection,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<(), sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        WITH mine AS (
            SELECT message_id, provider_label_id, seq, label_present
            FROM email_gmail_pending_label_writes
            WHERE message_id = ANY($1) AND write_id = $2
        ), next AS (
            SELECT DISTINCT ON (c.message_id, c.provider_label_id) c.seq, mine.label_present
            FROM email_gmail_pending_label_writes c
            JOIN mine ON c.message_id = mine.message_id
                AND c.provider_label_id = mine.provider_label_id AND c.seq > mine.seq
            ORDER BY c.message_id, c.provider_label_id, c.seq
        ), falls_back AS (
            UPDATE email_gmail_pending_label_writes c
            SET label_present_before = next.label_present
            FROM next
            WHERE c.seq = next.seq
        )
        DELETE FROM email_gmail_pending_label_writes c
        USING mine
        WHERE c.message_id = mine.message_id
            AND c.provider_label_id = mine.provider_label_id
            AND c.seq <= mine.seq
        "#,
        message_ids,
        write_id,
    )
    .execute(&mut *tx)
    .await?;

    Ok(())
}

/// Gives up `write_id`'s rows on `message_ids` because Gmail will never apply
/// them, and puts each label the write was the newest on back in the state
/// Gmail will end up with: that of the newest older write still on its way,
/// or the one before this write, which older writes given up pass on. An
/// older write whose row expired is presumed lost and no longer counts.
/// Labels a newer write changed keep that write's state. Returns the messages
/// whose labels were put back. Callers hold `lock_thread_label_writes` for
/// the messages' threads.
#[tracing::instrument(skip(tx, message_ids), err)]
pub async fn abandon_pending_label_writes(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<Vec<Uuid>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }

    let restored = sqlx::query!(
        r#"
        WITH mine AS (
            SELECT c.message_id, c.provider_label_id, c.seq, c.label_present_before,
                (SELECT min(newer.seq) FROM email_gmail_pending_label_writes newer
                 WHERE newer.message_id = c.message_id
                    AND newer.provider_label_id = c.provider_label_id
                    AND newer.seq > c.seq) AS newer_seq,
                (SELECT older.label_present FROM email_gmail_pending_label_writes older
                 WHERE older.message_id = c.message_id
                    AND older.provider_label_id = c.provider_label_id
                    AND older.seq < c.seq AND older.expires_at > now()
                 ORDER BY older.seq DESC
                 LIMIT 1) AS older_present
            FROM email_gmail_pending_label_writes c
            WHERE c.message_id = ANY($1) AND c.write_id = $2
        ), inherited AS (
            UPDATE email_gmail_pending_label_writes c
            SET label_present_before = mine.label_present_before
            FROM mine
            WHERE c.seq = mine.newer_seq
        ), removed AS (
            DELETE FROM email_gmail_pending_label_writes c
            USING mine
            WHERE c.seq = mine.seq
        )
        SELECT
            message_id AS "message_id!",
            provider_label_id AS "provider_label_id!",
            COALESCE(older_present, label_present_before) AS "label_present!"
        FROM mine
        WHERE newer_seq IS NULL
        "#,
        message_ids,
        write_id,
    )
    .fetch_all(&mut *tx)
    .await?;
    if restored.is_empty() {
        return Ok(Vec::new());
    }

    let (present, absent): (Vec<_>, Vec<_>) =
        restored.iter().partition(|restore| restore.label_present);
    let present_ids: Vec<Uuid> = present.iter().map(|restore| restore.message_id).collect();
    let present_labels: Vec<String> = present
        .iter()
        .map(|restore| restore.provider_label_id.clone())
        .collect();
    let absent_ids: Vec<Uuid> = absent.iter().map(|restore| restore.message_id).collect();
    let absent_labels: Vec<String> = absent
        .iter()
        .map(|restore| restore.provider_label_id.clone())
        .collect();
    sqlx::query!(
        r#"
        INSERT INTO email_message_labels (message_id, label_id)
        SELECT r.message_id, l.id
        FROM unnest($1::uuid[], $2::text[]) AS r(message_id, provider_label_id)
        JOIN email_labels l ON l.link_id = $3 AND l.provider_label_id = r.provider_label_id
        ON CONFLICT (message_id, label_id) DO NOTHING
        "#,
        &present_ids,
        &present_labels,
        link_id,
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        r#"
        DELETE FROM email_message_labels ml
        USING unnest($1::uuid[], $2::text[]) AS r(message_id, provider_label_id), email_labels l
        WHERE ml.message_id = r.message_id AND ml.label_id = l.id
            AND l.link_id = $3 AND l.provider_label_id = r.provider_label_id
        "#,
        &absent_ids,
        &absent_labels,
        link_id,
    )
    .execute(&mut *tx)
    .await?;

    let mut restored_ids: Vec<Uuid> = restored.iter().map(|restore| restore.message_id).collect();
    restored_ids.sort_unstable();
    restored_ids.dedup();
    sqlx::query!(
        r#"
        UPDATE email_messages m
        SET
            is_read = NOT EXISTS (
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON l.id = ml.label_id
                WHERE ml.message_id = m.id AND l.provider_label_id = $2
            ),
            is_starred = EXISTS (
                SELECT 1 FROM email_message_labels ml JOIN email_labels l ON l.id = ml.label_id
                WHERE ml.message_id = m.id AND l.provider_label_id = $3
            ),
            updated_at = now()
        WHERE m.id = ANY($1)
        "#,
        &restored_ids,
        system_labels::UNREAD,
        system_labels::STARRED,
    )
    .execute(&mut *tx)
    .await?;

    Ok(restored_ids)
}

/// Provider label ids on the message with a local change Gmail has not
/// confirmed yet.
#[tracing::instrument(skip(executor), err)]
pub async fn pending_provider_label_ids<'e, E>(
    executor: E,
    message_id: Uuid,
) -> Result<Vec<String>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT provider_label_id AS "provider_label_id!"
        FROM email_gmail_pending_label_writes
        WHERE message_id = $1 AND expires_at > now()
        ORDER BY provider_label_id
        "#,
        message_id,
    )
    .fetch_all(executor)
    .await
}
