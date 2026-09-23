//! Client-handle mapping tables: client-generated draft/thread identity as
//! lookup aliases over server-minted primary keys. Lookups scope to the
//! caller's accessible inboxes, so identical client handles from different
//! users never interact; the handle lock, the in-transaction re-read and the
//! binding upserts all run inside the message-insert transaction (see
//! `draft::insert_message`).

use crate::domain::models::SettledDraftIds;
use sqlx::PgPool;
use uuid::Uuid;

/// Resolve a client draft handle to its message ID within the given inboxes.
/// Newest binding wins if a handle ever appears under more than one link
/// (a moved draft re-binds under its new inbox).
#[tracing::instrument(skip(pool, link_ids), err)]
pub(crate) async fn message_id_for_client_draft_id(
    pool: &PgPool,
    client_id: Uuid,
    link_ids: &[Uuid],
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT message_id
        FROM email_draft_client_ids
        WHERE client_id = $1 AND link_id = ANY($2)
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        client_id,
        link_ids,
    )
    .fetch_optional(pool)
    .await
}

/// Resolve a client thread handle to its thread ID within the given inboxes.
#[tracing::instrument(skip(pool, link_ids), err)]
pub(crate) async fn thread_id_for_client_thread_id(
    pool: &PgPool,
    client_id: Uuid,
    link_ids: &[Uuid],
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT thread_id
        FROM email_thread_client_ids
        WHERE client_id = $1 AND link_id = ANY($2)
        ORDER BY created_at DESC
        LIMIT 1
        "#,
        client_id,
        link_ids,
    )
    .fetch_optional(pool)
    .await
}

/// Serialize saves that share one client draft handle in one inbox.
///
/// Held until the transaction commits, so a concurrent first save for the
/// same handle waits for the winner to bind before re-reading the mapping.
/// Without it both saves miss the (uncommitted) binding on their own
/// connections and each mints a full message + thread row set, leaving the
/// loser's rows orphaned when the binding upsert re-points the handle.
pub(super) async fn lock_draft_client_id(
    tx: &mut sqlx::PgConnection,
    client_id: Uuid,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
        format!("email_draft_client:{link_id}:{client_id}"),
    )
    .execute(tx)
    .await?;
    Ok(())
}

/// Re-read a client draft handle's binding inside the insert transaction,
/// returning the bound row and the thread it lives in. Scoped to the single
/// inbox the binding would be written under — the lock is per inbox too, so
/// a binding under another accessible inbox is not ours to converge on.
///
/// The join means a binding whose message has since been deleted reads as
/// unbound, and the save mints its own row as it would have anyway. Sent and
/// non-draft rows are returned: the upsert's owner guard, not this read,
/// decides whether the save may write them.
pub(super) async fn bound_draft_row(
    tx: &mut sqlx::PgConnection,
    client_id: Uuid,
    link_id: Uuid,
) -> Result<Option<SettledDraftIds>, sqlx::Error> {
    sqlx::query_as!(
        SettledDraftIds,
        r#"
        SELECT m.id AS "message_db_id!", m.thread_id AS "thread_db_id!"
        FROM email_draft_client_ids c
        JOIN email_messages m ON m.id = c.message_id
        WHERE c.link_id = $1 AND c.client_id = $2 AND m.link_id = $1
        "#,
        link_id,
        client_id,
    )
    .fetch_optional(tx)
    .await
}

/// Bind a client draft handle to its server-minted message row, re-pointing
/// an existing binding in the same inbox — replays and moved drafts converge
/// on whatever row the save settled on.
///
/// `created_at` is refreshed on the re-point because the cross-inbox lookup
/// orders by it: a rebind is a new binding, and leaving the original insert's
/// timestamp would strand it behind a stale binding under another inbox.
pub(super) async fn bind_draft_client_id(
    tx: &mut sqlx::PgConnection,
    client_id: Uuid,
    link_id: Uuid,
    message_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO email_draft_client_ids (client_id, link_id, message_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (link_id, client_id)
            DO UPDATE SET message_id = EXCLUDED.message_id, created_at = now()
        "#,
        client_id,
        link_id,
        message_id,
    )
    .execute(tx)
    .await?;
    Ok(())
}

/// Bind a client thread handle to its server-minted thread row. `created_at`
/// is refreshed on the re-point for the same reason as the draft binding.
pub(super) async fn bind_thread_client_id(
    tx: &mut sqlx::PgConnection,
    client_id: Uuid,
    link_id: Uuid,
    thread_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO email_thread_client_ids (client_id, link_id, thread_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (link_id, client_id)
            DO UPDATE SET thread_id = EXCLUDED.thread_id, created_at = now()
        "#,
        client_id,
        link_id,
        thread_id,
    )
    .execute(tx)
    .await?;
    Ok(())
}
