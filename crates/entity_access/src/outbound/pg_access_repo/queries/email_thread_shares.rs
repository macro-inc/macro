//! Email threads shared with a caller through `entity_access` grants.

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// An email thread a grant shares with the caller, with the inbox it lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SharedEmailThread {
    /// The shared thread.
    pub thread_id: Uuid,
    /// The inbox (`email_links.id`) holding the thread.
    pub link_id: Uuid,
}

/// Email threads granted to the caller, a channel they are in or one of their
/// teams, as the Email list's Shared view reads them, leaving out threads in
/// `own_link_ids`: those the caller reads through their own or a delegated
/// inbox. Non-empty `requested_ids` narrow the result to those threads. At
/// most `limit` threads come back.
///
/// The grants are read one of the caller's sources at a time and each thread
/// is then found by id: with stale statistics the planner otherwise scans
/// every grant, or every thread, and joins the rest.
#[tracing::instrument(
    err,
    skip(pool, user_id, own_link_ids, requested_ids),
    fields(
        requested_count = requested_ids.len(),
        shared_count = tracing::field::Empty,
    )
)]
pub async fn shared_email_threads(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
    own_link_ids: &[Uuid],
    requested_ids: &[Uuid],
    limit: i64,
) -> Result<Vec<SharedEmailThread>, sqlx::Error> {
    if limit <= 0 {
        return Ok(Vec::new());
    }
    let mut tx = Box::pin(pool.begin()).await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    let threads = sqlx::query_as!(
        SharedEmailThread,
        r#"
        WITH granted AS MATERIALIZED (
            SELECT DISTINCT ea.entity_id
            FROM entity_access_viewer_sources($1, NULL) AS sources(source_id)
            CROSS JOIN LATERAL (
                SELECT ea.entity_id
                FROM entity_access ea
                WHERE ea.source_id = sources.source_id
                  AND ea.entity_type = 'email_thread'
                  AND (cardinality($3::uuid[]) = 0 OR ea.entity_id = ANY($3))
                OFFSET 0
            ) ea
        )
        SELECT t.id AS "thread_id!", t.link_id AS "link_id!"
        FROM granted g
        CROSS JOIN LATERAL (
            SELECT t.id, t.link_id
            FROM email_threads t
            WHERE t.id = g.entity_id
            OFFSET 0
        ) t
        WHERE t.link_id <> ALL($2)
        LIMIT $4
        "#,
        user_id.as_ref(),
        own_link_ids,
        requested_ids,
        limit,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    tracing::Span::current().record("shared_count", threads.len());
    Ok(threads)
}
