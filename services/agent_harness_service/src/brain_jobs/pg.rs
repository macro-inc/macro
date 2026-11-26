//! Postgres adapter for the trusted brain job store.

use super::{
    AuthorizedAction, Claim, Completion, Dispatch, Job, JobKey, JobScope, JobStore, Lease, Outcome,
    PromptPins, Reservation, TaskTimeIntent, TimeEntryConfirmation,
};
use chrono::{DateTime, NaiveDate, Utc};
use rootcause::Report;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::{Uuid, Variant, Version};

type Tx<'a> = Transaction<'a, Postgres>;

const LEASE_SECONDS: i64 = 30;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("invalid brain job admission")]
    InvalidAdmission,
    #[error("brain job storage failed")]
    Internal(Report),
}

impl From<sqlx::Error> for StoreError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(Report::new(error).into_dynamic())
    }
}

impl From<strum::ParseError> for StoreError {
    fn from(error: strum::ParseError) -> Self {
        Self::Internal(Report::new(error).into_dynamic())
    }
}

/// Uses the agent harness service's MacroDB pool.
pub struct PgBrainJobs {
    pool: PgPool,
}

struct ClaimedRow {
    action_id: Uuid,
    task_id: String,
    work_date: NaiveDate,
    minutes: i16,
    repo_head_sha: String,
    charter_sha256: String,
    task_pack_id: String,
    task_pack_revision: String,
    deadline_at: DateTime<Utc>,
    lease_epoch: i64,
    outcome: Option<String>,
}

impl PgBrainJobs {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl JobStore for PgBrainJobs {
    type Err = StoreError;

    async fn admit(&self, job: &Job) -> Result<bool, StoreError> {
        let minutes =
            i16::try_from(job.intent.minutes).map_err(|_| StoreError::InvalidAdmission)?;
        if job.intent.action_id.get_version() != Some(Version::SortRand)
            || job.intent.action_id.get_variant() != Variant::RFC4122
        {
            return Err(StoreError::InvalidAdmission);
        }

        let result = sqlx::query!(
            r#"
            INSERT INTO agent_brain_job (
                team_id, user_id, id, action_id, task_id, work_date, minutes,
                repo_head_sha, charter_sha256, task_pack_id, task_pack_revision, deadline_at, lease_until
            )
            SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, statement_timestamp()
            WHERE $12 > statement_timestamp()
            ON CONFLICT DO NOTHING
            "#,
            job.key.scope.team_id,
            job.key.scope.user_id.as_ref(),
            job.key.id,
            job.intent.action_id,
            job.intent.task_id,
            job.intent.date,
            minutes,
            job.pins.repo_head_sha,
            job.pins.charter_sha256,
            job.pins.task_pack_id,
            job.pins.task_pack_revision,
            job.deadline,
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() == 1)
    }

    async fn claim(&self, scope: &JobScope, holder: Uuid) -> Result<Option<Claim>, StoreError> {
        let mut tx = self.pool.begin().await?;

        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;

        let Some(id) = sqlx::query_scalar!(
            r#"
            SELECT id FROM agent_brain_job
            WHERE team_id = $1 AND user_id = $2 AND outcome IS NULL
              AND lease_until <= statement_timestamp()
            ORDER BY lease_until, id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            "#,
            scope.team_id,
            scope.user_id.as_ref(),
        )
        .fetch_optional(&mut *tx)
        .await?
        else {
            return Ok(None);
        };

        // Use a fresh snapshot after taking the job lock so expiry observes
        // any receipt committed by the outgoing holder before the lock.
        let row = sqlx::query_as!(
            ClaimedRow,
            r#"
            WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS now)
            UPDATE agent_brain_job job
            SET lease_holder = CASE WHEN deadline_at > tick.now THEN $4::uuid END,
                lease_epoch = lease_epoch + 1,
                lease_until = LEAST(deadline_at, tick.now + $5::bigint * interval '1 second'),
                outcome = CASE WHEN deadline_at <= tick.now THEN
                    CASE WHEN EXISTS (
                        SELECT 1 FROM agent_brain_action_receipt
                        WHERE action_id = job.action_id AND confirmed_at IS NULL
                    ) THEN 'unknown_outcome' ELSE 'timed_out' END
                END
            FROM tick
            WHERE team_id = $1 AND user_id = $2 AND id = $3
            RETURNING action_id, task_id, work_date, minutes, repo_head_sha,
                      charter_sha256, task_pack_id, task_pack_revision, deadline_at, lease_epoch, outcome
            "#,
            scope.team_id,
            scope.user_id.as_ref(),
            id,
            holder,
            LEASE_SECONDS,
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;

        let key = JobKey {
            scope: scope.clone(),
            id,
        };
        if let Some(outcome) = row.outcome {
            return Ok(Some(Claim::Expired(key, outcome.parse()?)));
        }

        let minutes = u16::try_from(row.minutes)
            .map_err(|error| StoreError::Internal(Report::new(error).into_dynamic()))?;
        let job = Job {
            key,
            deadline: row.deadline_at,
            pins: PromptPins {
                repo_head_sha: row.repo_head_sha,
                charter_sha256: row.charter_sha256,
                task_pack_id: row.task_pack_id,
                task_pack_revision: row.task_pack_revision,
            },
            intent: TaskTimeIntent {
                action_id: row.action_id,
                task_id: row.task_id,
                date: row.work_date,
                minutes,
            },
        };

        Ok(Some(Claim::Active(Lease {
            job,
            holder,
            epoch: row.lease_epoch,
        })))
    }

    async fn renew(&self, lease: &Lease) -> Result<bool, StoreError> {
        let mut tx = self.pool.begin().await?;
        if !lock_owned(&mut tx, lease).await? {
            return Ok(false);
        }

        let key = &lease.job.key;
        let result = sqlx::query!(
            r#"
            WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS now)
            UPDATE agent_brain_job
            SET lease_until = LEAST(deadline_at, tick.now + $4::bigint * interval '1 second')
            FROM tick
            WHERE team_id = $1 AND user_id = $2 AND id = $3 AND lease_until > tick.now
            "#,
            key.scope.team_id,
            key.scope.user_id.as_ref(),
            key.id,
            LEASE_SECONDS,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        Ok(result.rows_affected() == 1)
    }

    async fn reserve<'a>(
        &self,
        action: AuthorizedAction<'a>,
    ) -> Result<Option<Reservation<'a>>, StoreError> {
        let mut tx = self.pool.begin().await?;
        if !lock_owned(&mut tx, action.lease).await? {
            return Ok(None);
        }

        let key = &action.lease.job.key;
        let row = sqlx::query!(
            r#"
            WITH eligible AS MATERIALIZED (
                SELECT action_id, lease_epoch FROM agent_brain_job
                WHERE team_id = $1 AND user_id = $2 AND id = $3 AND lease_until > clock_timestamp()
            ), inserted AS (
                INSERT INTO agent_brain_action_receipt (action_id, dispatch_epoch)
                SELECT action_id, lease_epoch FROM eligible
                ON CONFLICT DO NOTHING
                RETURNING action_id
            )
            SELECT EXISTS (SELECT 1 FROM inserted) AS "inserted!",
                   EXISTS (
                       SELECT 1 FROM agent_brain_action_receipt
                       WHERE action_id = eligible.action_id AND confirmed_at IS NOT NULL
                   ) AS "confirmed!"
            FROM eligible
            "#,
            key.scope.team_id,
            key.scope.user_id.as_ref(),
            key.id,
        )
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;

        Ok(row.map(|row| match (row.inserted, row.confirmed) {
            (true, _) => Reservation::Dispatch(Dispatch(action.lease)),
            (false, true) => Reservation::AlreadyCommitted,
            (false, false) => Reservation::ReconcileOnly,
        }))
    }

    async fn reconcile(
        &self,
        action: AuthorizedAction<'_>,
        confirmation: &TimeEntryConfirmation,
    ) -> Result<bool, StoreError> {
        if !action.matches(confirmation) {
            return Ok(false);
        }

        let mut tx = self.pool.begin().await?;
        if !lock_owned(&mut tx, action.lease).await? {
            return Ok(false);
        }

        let key = &action.lease.job.key;
        let result = sqlx::query!(
            r#"
            UPDATE agent_brain_action_receipt receipt SET confirmed_at = clock_timestamp()
            FROM agent_brain_job job
            WHERE job.team_id = $1 AND job.user_id = $2 AND job.id = $3
              AND job.lease_until > clock_timestamp()
              AND receipt.action_id = job.action_id AND receipt.confirmed_at IS NULL
            "#,
            key.scope.team_id,
            key.scope.user_id.as_ref(),
            key.id,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        Ok(result.rows_affected() == 1)
    }

    async fn finalize(
        &self,
        lease: &Lease,
        completion: Completion,
    ) -> Result<Option<Outcome>, StoreError> {
        let mut tx = self.pool.begin().await?;
        if !lock_owned(&mut tx, lease).await? {
            return Ok(None);
        }

        let outcome = settle(&mut tx, &lease.job.key, completion.as_ref()).await?;
        tx.commit().await?;
        Ok(outcome)
    }

    async fn revoke(&self, key: &JobKey) -> Result<Option<Outcome>, StoreError> {
        let mut tx = self.pool.begin().await?;

        let locked = sqlx::query_scalar!(
            r#"
            SELECT id FROM agent_brain_job
            WHERE team_id = $1 AND user_id = $2 AND id = $3 AND outcome IS NULL
            FOR UPDATE
            "#,
            key.scope.team_id,
            key.scope.user_id.as_ref(),
            key.id,
        )
        .fetch_optional(&mut *tx)
        .await?;
        if locked.is_none() {
            return Ok(None);
        }

        let outcome = settle(&mut tx, key, "cancelled").await?;
        tx.commit().await?;
        Ok(outcome)
    }
}

/// Every receipt mutation first locks its scoped job with the current fence.
/// Check the clock after acquiring the lock, including when another
/// transaction delayed it past the lease or deadline.
async fn lock_owned(tx: &mut Tx<'_>, lease: &Lease) -> Result<bool, StoreError> {
    let key = &lease.job.key;

    Ok(sqlx::query_scalar!(
        r#"
        WITH locked AS MATERIALIZED (
            SELECT lease_until FROM agent_brain_job
            WHERE team_id = $1 AND user_id = $2 AND id = $3 AND outcome IS NULL
              AND lease_holder = $4 AND lease_epoch = $5
            FOR UPDATE
        )
        SELECT lease_until > clock_timestamp() AS "active!" FROM locked
        "#,
        key.scope.team_id,
        key.scope.user_id.as_ref(),
        key.id,
        lease.holder,
        lease.epoch,
    )
    .fetch_optional(&mut **tx)
    .await?
    .unwrap_or(false))
}

/// Called only with the scoped job row locked. The receipt survives terminal
/// outcomes and keeps the original dispatch epoch, including after revoke.
async fn settle(
    tx: &mut Tx<'_>,
    key: &JobKey,
    outcome: &str,
) -> Result<Option<Outcome>, StoreError> {
    let stored = sqlx::query_scalar!(
        r#"
        UPDATE agent_brain_job job
        SET lease_holder = NULL,
            outcome = CASE WHEN EXISTS (
                SELECT 1 FROM agent_brain_action_receipt
                WHERE action_id = job.action_id AND confirmed_at IS NULL
            ) THEN 'unknown_outcome' ELSE $4 END
        WHERE team_id = $1 AND user_id = $2 AND id = $3
          AND ($4 = 'cancelled' OR lease_until > clock_timestamp())
        RETURNING outcome AS "outcome!"
        "#,
        key.scope.team_id,
        key.scope.user_id.as_ref(),
        key.id,
        outcome,
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(stored.map(|outcome| outcome.parse()).transpose()?)
}
