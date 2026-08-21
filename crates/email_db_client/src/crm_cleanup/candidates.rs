use models_email::email::service::crm_cleanup::CrmCleanupCandidate;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Upserts one cleanup candidate per email for the link. The unique index on
/// `(link_id, contact_email)` dedupes repeat deletes into a single pending row.
///
/// A repeat delete refreshes `created_at` rather than being ignored: the
/// lister treats that timestamp as a settling clock for asynchronous CRM
/// populate, and each new deletion implies a new message that may have its own
/// populate still in flight. Keeping the original timestamp would let the
/// clock expire while that populate is pending.
///
/// Returns the number of rows recorded (inserted or refreshed).
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
        ON CONFLICT (link_id, contact_email) DO UPDATE SET created_at = now()
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
        SELECT id, link_id, contact_email, created_at
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

/// Claims (deletes) a batch of candidate rows in one statement. Used by the
/// lister to retire pairs that have nothing to tear down, instead of spending
/// one `ProcessCandidate` message each to reach the same conclusion.
///
/// Same semantics as [`claim_candidate`], just set-based: a delete landing
/// concurrently re-inserts a fresh row that the next run picks up. Returns the
/// number of rows removed.
#[tracing::instrument(skip(pool, pairs), fields(pair_count = pairs.len()), err)]
pub async fn claim_candidates(pool: &PgPool, pairs: &[(Uuid, String)]) -> anyhow::Result<u64> {
    if pairs.is_empty() {
        return Ok(0);
    }

    let (link_ids, contact_emails): (Vec<Uuid>, Vec<String>) = pairs.iter().cloned().unzip();

    let result = sqlx::query!(
        r#"
        DELETE FROM crm_cleanup_candidates c
        USING UNNEST($1::uuid[], $2::text[]) AS p(link_id, contact_email)
        WHERE c.link_id = p.link_id AND c.contact_email = p.contact_email
        "#,
        &link_ids,
        &contact_emails,
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
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
