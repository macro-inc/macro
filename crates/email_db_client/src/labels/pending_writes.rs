use models_email::email::service::label::system_labels;
use sqlx::types::Uuid;
use sqlx::{Executor, PgConnection, Postgres};

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

/// Facts returned for one requested message/label pair.
#[derive(Debug)]
pub struct LabelWriteFacts {
    pub message_id: Uuid,
    pub claimed: bool,
    pub has_newer: bool,
    pub waits: bool,
}

/// State selected atomically when removing a pending write.
#[derive(Debug)]
pub struct LabelRestore {
    pub message_id: Uuid,
    pub provider_label_id: String,
    pub label_present: bool,
}

/// Read claim, newer-row, and live-newer-row facts for each requested pair.
/// The caller interprets these facts and combines them across labels.
pub async fn label_write_facts<'e, E>(
    executor: E,
    message_ids: &[Uuid],
    provider_label_ids: &[String],
    write_id: Uuid,
) -> Result<Vec<LabelWriteFacts>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_as!(
        LabelWriteFacts,
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
    .await
}

/// Gmail applied `write_id` on `message_ids`: removes its rows and those of
/// every older write on the same labels, which Gmail no longer needs. A
/// newer write's row now falls back to this write's state. Callers hold
/// `lock_thread_label_writes` for the messages' threads.
pub async fn confirm_pending_label_writes(
    tx: &mut PgConnection,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<(), sqlx::Error> {
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

/// Remove a pending write and atomically select any fallback label states.
/// The caller holds the thread locks and applies the returned states.
pub async fn remove_pending_label_write(
    tx: &mut PgConnection,
    message_ids: &[Uuid],
    write_id: Uuid,
) -> Result<Vec<LabelRestore>, sqlx::Error> {
    sqlx::query_as!(
        LabelRestore,
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
    .await
}

/// Insert the supplied message/provider-label pairs.
pub async fn restore_present_labels(
    tx: &mut PgConnection,
    link_id: Uuid,
    present_ids: &[Uuid],
    present_labels: &[String],
) -> Result<(), sqlx::Error> {
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
    Ok(())
}

/// Delete the supplied message/provider-label pairs.
pub async fn restore_absent_labels(
    tx: &mut PgConnection,
    link_id: Uuid,
    absent_ids: &[Uuid],
    absent_labels: &[String],
) -> Result<(), sqlx::Error> {
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

    Ok(())
}

/// Refresh flags for exactly the supplied restored messages.
pub async fn refresh_restored_flags(
    tx: &mut PgConnection,
    restored_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
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

    Ok(())
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
