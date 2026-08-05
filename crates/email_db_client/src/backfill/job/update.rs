use models_email::email::db;
use models_email::email::service;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Result of attempting to claim one email-backfill initialization lease.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitLeaseClaim {
    /// This caller owns the returned lease token.
    Claimed(Uuid),
    /// Initialization already reached a later durable state.
    Complete,
    /// Another worker currently owns initialization.
    Busy,
    /// The requested backfill job does not exist.
    NotFound,
}

/// Result of attempting to renew an email-backfill initialization lease.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitLeaseRenewal {
    /// The lease was extended.
    Renewed,
    /// Initialization already reached a later durable state.
    Complete,
    /// The lease is no longer owned by this worker.
    Lost,
    /// The requested backfill job does not exist.
    NotFound,
}

/// Result of attempting to atomically complete an email backfill.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BackfillCompletion {
    /// This caller completed the active job and published its completion effects.
    Completed,
    /// The job had already reached a terminal state.
    AlreadyTerminal,
    /// The job is active, but this caller does not hold the required lease.
    LeaseLost,
    /// The requested backfill job does not exist.
    NotFound,
}

#[tracing::instrument(skip(executor), err)]
pub async fn update_backfill_job_status<'e, E>(
    executor: E,
    job_id: Uuid,
    status: service::backfill::BackfillJobStatus,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let db_status: service::backfill::BackfillJobStatus = status;
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET status = $1::email_backfill_job_status, updated_at = now()
        WHERE id = $2
        "#,
        db_status as _,
        job_id
    )
    .execute(executor)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("No backfill job found with ID: {}", job_id);
    }

    Ok(())
}

/// Claim initialization for an email backfill, allowing expired work to resume.
#[tracing::instrument(skip(pool), err)]
pub async fn claim_init_lease(pool: &PgPool, job_id: Uuid) -> anyhow::Result<InitLeaseClaim> {
    let lease_token = Uuid::now_v7();
    let claimed = sqlx::query_scalar!(
        r#"
        UPDATE email_backfill_jobs
        SET init_lease_token = $2,
            init_lease_expires_at = now() + interval '2 minutes',
            updated_at = now()
        WHERE id = $1
          AND status = 'Init'
          AND initialized_at IS NULL
          AND (
              init_lease_expires_at IS NULL
              OR init_lease_expires_at < now()
          )
        RETURNING init_lease_token AS "init_lease_token!"
        "#,
        job_id,
        lease_token,
    )
    .fetch_optional(pool)
    .await?;
    if let Some(lease_token) = claimed {
        return Ok(InitLeaseClaim::Claimed(lease_token));
    }

    let state = sqlx::query!(
        r#"
        SELECT status::text AS "status!", initialized_at
        FROM email_backfill_jobs
        WHERE id = $1
        "#,
        job_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(match state {
        Some(state) if state.initialized_at.is_some() || state.status != "Init" => {
            InitLeaseClaim::Complete
        }
        Some(_) => InitLeaseClaim::Busy,
        None => InitLeaseClaim::NotFound,
    })
}

/// Renew initialization while the caller still owns the lease.
#[tracing::instrument(skip(pool), err)]
pub async fn renew_init_lease(
    pool: &PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> anyhow::Result<InitLeaseRenewal> {
    let updated = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET init_lease_expires_at = now() + interval '2 minutes',
            updated_at = now()
        WHERE id = $1
          AND status = 'Init'
          AND init_lease_token = $2
          AND init_lease_expires_at > now()
        "#,
        job_id,
        lease_token,
    )
    .execute(pool)
    .await?;
    if updated.rows_affected() == 1 {
        return Ok(InitLeaseRenewal::Renewed);
    }

    let state = sqlx::query!(
        r#"
        SELECT status::text AS "status!", initialized_at
        FROM email_backfill_jobs
        WHERE id = $1
        "#,
        job_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(match state {
        Some(state) if state.initialized_at.is_some() || state.status != "Init" => {
            InitLeaseRenewal::Complete
        }
        Some(_) => InitLeaseRenewal::Lost,
        None => InitLeaseRenewal::NotFound,
    })
}

/// Release an initialization lease still owned by the caller.
#[tracing::instrument(skip(pool), err)]
pub async fn release_init_lease(
    pool: &PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> anyhow::Result<bool> {
    let released = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET init_lease_token = NULL,
            init_lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1
          AND status = 'Init'
          AND init_lease_token = $2
        "#,
        job_id,
        lease_token,
    )
    .execute(pool)
    .await?;
    Ok(released.rows_affected() == 1)
}

/// Atomically publish initialization and transition the leased job in progress.
#[tracing::instrument(skip(pool), err)]
pub async fn finalize_initialization(
    pool: &PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"
        INSERT INTO email_backfill_init_outbox (id, backfill_job_id)
        VALUES ($1, $2)
        ON CONFLICT (backfill_job_id) DO NOTHING
        "#,
        Uuid::now_v7(),
        job_id,
    )
    .execute(&mut *tx)
    .await?;
    let finalized = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET status = 'InProgress',
            initialized_at = now(),
            init_lease_token = NULL,
            init_lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1
          AND status = 'Init'
          AND init_lease_token = $2
          AND init_lease_expires_at > now()
        "#,
        job_id,
        lease_token,
    )
    .execute(&mut *tx)
    .await?;
    if finalized.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(false);
    }
    tx.commit().await?;
    Ok(true)
}

/// Fails an active email backfill job.
#[tracing::instrument(skip(pool), err)]
pub async fn fail_backfill_job(pool: &PgPool, job_id: Uuid) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    let failed = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET status = 'Failed',
            updated_at = now()
        WHERE id = $1
          AND status IN ('Init', 'InProgress')
        "#,
        job_id,
    )
    .execute(&mut *tx)
    .await?;

    if failed.rows_affected() == 0 {
        tx.commit().await?;
        return Ok(false);
    }

    tx.commit().await?;
    Ok(true)
}

/// Completes an active email backfill, returning a durable outcome for
/// idempotency and fencing.
#[tracing::instrument(skip(pool), err)]
pub async fn complete_backfill_job(
    pool: &PgPool,
    job_id: Uuid,
    init_lease_token: Option<Uuid>,
) -> anyhow::Result<BackfillCompletion> {
    let mut tx = pool.begin().await?;
    let completed = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET status = 'Complete',
            initialized_at = COALESCE(initialized_at, now()),
            init_lease_token = NULL,
            init_lease_expires_at = NULL,
            updated_at = now()
        WHERE id = $1
          AND (
              (
                  status = 'Init'
                  AND $2::uuid IS NOT NULL
                  AND init_lease_token = $2
                  AND init_lease_expires_at > now()
              )
              OR (
                  status = 'InProgress'
                  AND $2::uuid IS NULL
              )
          )
        "#,
        job_id,
        init_lease_token,
    )
    .execute(&mut *tx)
    .await?;

    if completed.rows_affected() == 0 {
        let status = sqlx::query_scalar!(
            r#"
            SELECT status::text AS "status!"
            FROM email_backfill_jobs
            WHERE id = $1
            "#,
            job_id,
        )
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(match status.as_deref() {
            Some("Complete" | "Failed" | "Cancelled") => BackfillCompletion::AlreadyTerminal,
            Some(_) => BackfillCompletion::LeaseLost,
            None => BackfillCompletion::NotFound,
        });
    }

    sqlx::query!(
        r#"
        INSERT INTO email_backfill_completion_outbox (id, backfill_job_id)
        VALUES ($1, $2)
        ON CONFLICT (backfill_job_id) DO NOTHING
        "#,
        Uuid::now_v7(),
        job_id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(BackfillCompletion::Completed)
}

/// Returns whether durable post-completion effects still need to run.
#[tracing::instrument(skip(pool), err)]
pub async fn completion_effects_pending(pool: &PgPool, job_id: Uuid) -> anyhow::Result<bool> {
    let pending = sqlx::query_scalar!(
        r#"
        SELECT completed_at IS NULL AS "pending!"
        FROM email_backfill_completion_outbox
        WHERE backfill_job_id = $1
        "#,
        job_id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(pending.unwrap_or(false))
}

/// Claims durable post-completion effects for one worker.
///
/// The lease prevents duplicate queue deliveries from running the same effects
/// concurrently. An expired lease can be reclaimed after a worker crash.
#[tracing::instrument(skip(pool), err)]
pub async fn claim_completion_effects(pool: &PgPool, job_id: Uuid) -> anyhow::Result<Option<Uuid>> {
    let lease_token = Uuid::now_v7();
    let claimed = sqlx::query_scalar!(
        r#"
        UPDATE email_backfill_completion_outbox
        SET effects_lease_token = $2,
            effects_lease_expires_at = now() + interval '2 minutes'
        WHERE backfill_job_id = $1
          AND completed_at IS NULL
          AND (
              effects_lease_token IS NULL
              OR effects_lease_expires_at < now()
          )
        RETURNING effects_lease_token AS "effects_lease_token!"
        "#,
        job_id,
        lease_token,
    )
    .fetch_optional(pool)
    .await?;
    Ok(claimed)
}

/// Extends a completion-effects lease owned by `lease_token`.
#[tracing::instrument(skip(pool), err)]
pub async fn renew_completion_effects(
    pool: &PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> anyhow::Result<bool> {
    let renewed = sqlx::query!(
        r#"
        UPDATE email_backfill_completion_outbox
        SET effects_lease_expires_at = now() + interval '2 minutes'
        WHERE backfill_job_id = $1
          AND completed_at IS NULL
          AND effects_lease_token = $2
          AND effects_lease_expires_at > now()
        "#,
        job_id,
        lease_token,
    )
    .execute(pool)
    .await?;
    Ok(renewed.rows_affected() == 1)
}

/// Releases a completion-effects lease owned by `lease_token`.
#[tracing::instrument(skip(pool), err)]
pub async fn release_completion_effects(
    pool: &PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> anyhow::Result<bool> {
    let released = sqlx::query!(
        r#"
        UPDATE email_backfill_completion_outbox
        SET effects_lease_token = NULL,
            effects_lease_expires_at = NULL
        WHERE backfill_job_id = $1
          AND completed_at IS NULL
          AND effects_lease_token = $2
        "#,
        job_id,
        lease_token,
    )
    .execute(pool)
    .await?;
    Ok(released.rows_affected() == 1)
}

/// Marks durable post-completion effects complete after every effect succeeds.
///
/// The lease token fences out stale workers whose lease expired and was
/// reclaimed while they were still running.
#[tracing::instrument(skip(pool), err)]
pub async fn mark_completion_effects_complete(
    pool: &PgPool,
    job_id: Uuid,
    lease_token: Uuid,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_completion_outbox
        SET completed_at = now()
        WHERE backfill_job_id = $1
          AND completed_at IS NULL
          AND effects_lease_token = $2
          AND effects_lease_expires_at > now()
        "#,
        job_id,
        lease_token,
    )
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        anyhow::bail!("no pending completion effects for backfill job {job_id}");
    }
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn cancel_active_jobs_by_link_id(pool: &PgPool, link_id: Uuid) -> anyhow::Result<usize> {
    let db_status = db::backfill::BackfillJobStatus::Cancelled;

    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET status = $1::email_backfill_job_status, updated_at = now()
        WHERE link_id = $2
        AND status IN ('Init', 'InProgress')
        "#,
        db_status as _,
        link_id
    )
    .execute(pool)
    .await?;

    let rows_affected = result.rows_affected() as usize;
    Ok(rows_affected)
}

#[tracing::instrument(skip(pool), err)]
pub async fn update_job_total_threads(
    pool: &PgPool,
    job_id: Uuid,
    num_threads: i32,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET total_threads = $1, updated_at = now()
        WHERE id = $2
        "#,
        num_threads,
        job_id
    )
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("No backfill job found with ID: {}", job_id);
    }

    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn update_job_threads_retrieved_count(
    pool: &PgPool,
    job_id: Uuid,
    num_threads: i32,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE email_backfill_jobs
        SET threads_retrieved_count = threads_retrieved_count + $1, updated_at = now()
        WHERE id = $2
        "#,
        num_threads,
        job_id
    )
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("No backfill job found with ID: {}", job_id);
    }

    Ok(())
}

#[cfg(test)]
mod test;
