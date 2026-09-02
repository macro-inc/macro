//! Client-handle mapping tables: client-generated draft/thread identity as
//! lookup aliases over server-minted primary keys. Lookups scope to the
//! caller's accessible inboxes, so identical client handles from different
//! users never interact; binding upserts run inside the message-insert
//! transaction (see `draft::insert_message`).

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

/// Bind a client draft handle to its server-minted message row, re-pointing
/// an existing binding in the same inbox — replays and moved drafts converge
/// on whatever row the save settled on.
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
            DO UPDATE SET message_id = EXCLUDED.message_id
        "#,
        client_id,
        link_id,
        message_id,
    )
    .execute(tx)
    .await?;
    Ok(())
}

/// Bind a client thread handle to its server-minted thread row.
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
            DO UPDATE SET thread_id = EXCLUDED.thread_id
        "#,
        client_id,
        link_id,
        thread_id,
    )
    .execute(tx)
    .await?;
    Ok(())
}
