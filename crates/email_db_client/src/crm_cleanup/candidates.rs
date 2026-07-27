use models_email::email::service::crm_cleanup::CrmCleanupCandidate;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Upserts one cleanup candidate per email for the link. The unique index on
/// `(link_id, contact_email)` dedupes repeat deletes into a single pending row.
/// Returns the number of rows actually inserted.
#[tracing::instrument(skip(pool, contact_emails), err)]
pub async fn insert_candidates(
    pool: &PgPool,
    link_id: Uuid,
    contact_emails: &[String],
) -> anyhow::Result<u64> {
    if contact_emails.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        INSERT INTO crm_cleanup_candidates (link_id, contact_email)
        SELECT $1, unnest($2::text[])
        ON CONFLICT (link_id, contact_email) DO NOTHING
        "#,
        link_id,
        contact_emails
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

/// Fetches one keyset page of candidates: `last_id < id <= max_id`, ordered by
/// id. Rows deleted behind the cursor just leave gaps the predicate skips, so
/// pagination never loses its place.
#[tracing::instrument(skip(pool), err)]
pub async fn list_candidates_page(
    pool: &PgPool,
    last_id: i64,
    max_id: i64,
    limit: i64,
) -> anyhow::Result<Vec<CrmCleanupCandidate>> {
    let candidates = sqlx::query_as!(
        CrmCleanupCandidate,
        r#"
        SELECT id, link_id, contact_email
        FROM crm_cleanup_candidates
        WHERE id > $1 AND id <= $2
        ORDER BY id
        LIMIT $3
        "#,
        last_id,
        max_id,
        limit
    )
    .fetch_all(pool)
    .await?;

    Ok(candidates)
}

/// Claims (deletes) the candidate row for a pair. Returns `true` when the row
/// existed. Claiming happens before the depopulate check so a message delete
/// that lands mid-processing re-inserts a fresh row for the next run instead
/// of being swallowed.
#[tracing::instrument(skip(pool), err)]
pub async fn claim_candidate(
    pool: &PgPool,
    link_id: Uuid,
    contact_email: &str,
) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        DELETE FROM crm_cleanup_candidates
        WHERE link_id = $1 AND contact_email = $2
        "#,
        link_id,
        contact_email
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Returns `(max_id, count)` over all candidate rows, or `None` when the table
/// is empty. Snapshotting `max_id` at job kickoff freezes the job's working
/// set: rows inserted later get higher ids and wait for the next run.
#[tracing::instrument(skip(pool), err)]
pub async fn get_max_id_and_count(pool: &PgPool) -> anyhow::Result<Option<(i64, i64)>> {
    let row = sqlx::query!(
        r#"
        SELECT MAX(id) as "max_id", COUNT(*) as "count!"
        FROM crm_cleanup_candidates
        "#
    )
    .fetch_one(pool)
    .await?;

    Ok(row.max_id.map(|max_id| (max_id, row.count)))
}

#[cfg(test)]
mod test;
