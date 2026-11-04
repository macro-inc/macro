//! Explicit, operator-controlled replacement of an unreconcilable legacy job.

use sqlx::PgPool;
use sqlx::types::Uuid;

/// The replacement Init operation to publish after committing recovery.
#[derive(Debug, PartialEq, Eq)]
pub struct RecoveryJob {
    pub job_id: Uuid,
    pub link_id: Uuid,
}

/// Atomically cancel one active legacy job and create one full recovery job.
/// Retries return the same replacement. Deleted links, terminal jobs without
/// a replacement, and already-durable jobs are refused without mutation.
/// The caller must publish Init after commit; publication is safe to repeat.
#[tracing::instrument(skip(pool), err)]
pub async fn restart_legacy_job(pool: &PgPool, job_id: Uuid) -> anyhow::Result<RecoveryJob> {
    let mut tx = pool.begin().await?;
    let old = sqlx::query!(
        r#"SELECT link_id, fusionauth_user_id, status::text AS "status!", completed_threads
        FROM email_backfill_jobs WHERE id = $1 FOR UPDATE"#,
        job_id
    )
    .fetch_one(&mut *tx)
    .await?;
    let link_id = old
        .link_id
        .ok_or_else(|| anyhow::anyhow!("deleted link cannot be recovered"))?;
    // Fence both physical deletion and the soft-delete marker, including on a
    // repeated command. Link teardown must not gain a new recovery job.
    sqlx::query_scalar!(
        "SELECT id FROM email_links WHERE id = $1 AND deleting_at IS NULL FOR SHARE",
        link_id
    )
    .fetch_one(&mut *tx)
    .await?;
    if let Some(existing) = sqlx::query_as!(
        RecoveryJob,
        r#"SELECT id AS job_id, link_id AS "link_id!" FROM email_backfill_jobs
        WHERE recovery_of = $1 AND link_id IS NOT NULL"#,
        job_id
    )
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.commit().await?;
        return Ok(existing);
    }
    anyhow::ensure!(
        old.completed_threads.is_none() && old.status == "InProgress",
        "only active legacy jobs can be replaced"
    );
    // A newer active job is protected by the per-link partial unique index.
    sqlx::query!(
        "UPDATE email_backfill_jobs SET status = 'Cancelled', updated_at = now() WHERE id = $1",
        job_id
    )
    .execute(&mut *tx)
    .await?;
    let replacement = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_backfill_jobs
            (id, link_id, fusionauth_user_id, status, is_recovery, recovery_of)
        VALUES ($1, $2, $3, 'Init', true, $4)"#,
        replacement,
        link_id,
        old.fusionauth_user_id,
        job_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(RecoveryJob {
        job_id: replacement,
        link_id,
    })
}

#[cfg(test)]
mod test;
