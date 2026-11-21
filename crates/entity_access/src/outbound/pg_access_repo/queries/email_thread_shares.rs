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

/// The email threads in the given Drive folders (`email_threads.project_id`)
/// that the caller may read, as the Email list's project candidates admit
/// them: their own threads in a folder (`include_own`), every thread in a
/// folder granted to the caller, a channel they are in or one of their teams,
/// whatever inbox holds it, and, with `include_thread_shares`, threads in a
/// folder shared with them through a grant on the thread. With `include_own`
/// false the caller's own inboxes are left out entirely, as the list's
/// Shared-only view leaves them out. Non-empty `requested_ids` narrow each
/// folder's threads before the limit applies, so a requested thread is never
/// cut off by the rest of its folder. At most `limit` threads come back.
///
/// Each folder's grants are read once through
/// `idx_entity_access_entity_text_type_source` and matched against the
/// caller's memberships. Each folder's threads are read through
/// `idx_email_threads_project_id` and stop at `limit`, so a large granted
/// folder is not read whole; a thread belongs to one folder, so no thread
/// comes back twice. A thread share outside the caller's inboxes, in a folder
/// not granted to them, is matched against the caller's sources, listed once
/// in the statement, so Postgres may read the caller's email-thread grants
/// once through `idx_entity_access_source_type_entity_plain` or probe each
/// thread through `entity_access_entity_id_entity_type_idx`. Matching each of
/// a thread's grants with `entity_access_source_matches` instead makes
/// Postgres hash every email-thread grant, or probe every thread of a large
/// folder shared with no one.
#[tracing::instrument(
    err,
    skip(pool, user_id, own_link_ids, project_ids, requested_ids),
    fields(
        project_count = project_ids.len(),
        requested_count = requested_ids.len(),
        thread_count = tracing::field::Empty,
    )
)]
#[expect(
    clippy::too_many_arguments,
    reason = "each argument is one bind of the folder query"
)]
pub async fn project_email_threads(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
    own_link_ids: &[Uuid],
    project_ids: &[String],
    requested_ids: &[Uuid],
    include_own: bool,
    include_thread_shares: bool,
    limit: i64,
) -> Result<Vec<SharedEmailThread>, sqlx::Error> {
    if project_ids.is_empty() || limit <= 0 {
        return Ok(Vec::new());
    }
    let mut tx = Box::pin(pool.begin()).await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    let threads = sqlx::query_as!(
        SharedEmailThread,
        r#"
        WITH requested AS MATERIALIZED (
            SELECT DISTINCT p.project_id
            FROM unnest($3::text[]) AS p(project_id)
        ),
        granted AS MATERIALIZED (
            SELECT r.project_id
            FROM requested r
            WHERE EXISTS (
                SELECT 1
                FROM entity_access ea
                WHERE ea.entity_id::text = r.project_id
                  AND ea.entity_type = 'project'
                  AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $1, NULL))
                OFFSET 0
            )
        )
        SELECT f.id AS "thread_id!", f.link_id AS "link_id!"
        FROM requested r
        CROSS JOIN LATERAL (
            SELECT t.id, t.link_id
            FROM email_threads t
            WHERE t.project_id = r.project_id
              AND (cardinality($7::uuid[]) = 0 OR t.id = ANY($7))
              AND CASE
                  WHEN t.link_id = ANY($2) THEN $4
                  WHEN r.project_id IN (SELECT g.project_id FROM granted g) THEN TRUE
                  ELSE $5 AND EXISTS (
                      SELECT 1
                      FROM entity_access ea
                      WHERE ea.entity_id = t.id
                        AND ea.entity_type = 'email_thread'
                        AND ea.source_id = ANY(ARRAY(
                            SELECT s.source_id
                            FROM entity_access_viewer_sources($1, NULL) AS s(source_id)
                        ))
                  )
              END
            LIMIT $6
        ) f
        LIMIT $6
        "#,
        user_id.as_ref(),
        own_link_ids,
        project_ids,
        include_own,
        include_thread_shares,
        limit,
        requested_ids,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    tracing::Span::current().record("thread_count", threads.len());
    Ok(threads)
}

/// Which of `thread_ids`, outside `own_link_ids`, sit in a Drive folder
/// granted to the caller, a channel they are in or one of their teams, with
/// the inbox holding each: the threads the caller reads through a folder
/// share, as the Email list's project candidates admit them. Each id is one
/// primary-key lookup and one probe of its folder's grants through
/// `idx_entity_access_entity_text_type_source`, each matched against the
/// caller's memberships, so the cost does not grow with them.
#[tracing::instrument(
    err,
    skip(pool, user_id, own_link_ids, thread_ids),
    fields(
        requested_count = thread_ids.len(),
        shared_count = tracing::field::Empty,
    )
)]
pub async fn project_shared_email_threads(
    pool: &PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
    own_link_ids: &[Uuid],
    thread_ids: &[Uuid],
) -> Result<Vec<SharedEmailThread>, sqlx::Error> {
    if thread_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut tx = Box::pin(pool.begin()).await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *tx)
        .await?;
    let threads = sqlx::query_as!(
        SharedEmailThread,
        r#"
        SELECT t.id AS "thread_id!", t.link_id AS "link_id!"
        FROM unnest($3::uuid[]) AS ids(id)
        CROSS JOIN LATERAL (
            SELECT t.id, t.link_id, t.project_id
            FROM email_threads t
            WHERE t.id = ids.id
            OFFSET 0
        ) t
        WHERE t.project_id IS NOT NULL
          AND t.link_id <> ALL($2)
          AND EXISTS (
              SELECT 1
              FROM entity_access ea
              WHERE ea.entity_id::text = t.project_id
                AND ea.entity_type = 'project'
                AND EXISTS (SELECT FROM entity_access_source_matches(ea.source_id, $1, NULL))
              OFFSET 0
          )
        "#,
        user_id.as_ref(),
        own_link_ids,
        thread_ids,
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    tracing::Span::current().record("shared_count", threads.len());
    Ok(threads)
}
