//! Lease storage and the database fence shared by image and runtime updates.

use super::{PgComputerError, PgComputerRepo, Tx};
use crate::domain::ids::ComputerId;
use crate::domain::runtime_update::{
    RuntimeBundle, RuntimeUpdate, RuntimeUpdateOutcome, RuntimeUpdates,
};
use chrono::Duration;
use uuid::Uuid;

impl PgComputerRepo {
    pub(super) async fn runtime_update_pending(
        tx: &mut Tx<'_>,
        computer: ComputerId,
    ) -> Result<bool, PgComputerError> {
        Ok(sqlx::query_scalar!(
            r#"SELECT EXISTS (
                SELECT 1 FROM agent_runtime_update WHERE computer_id = $1 AND outcome IS NULL
            ) AS "pending!""#,
            computer.as_uuid(),
        )
        .fetch_one(&mut **tx)
        .await?)
    }
}

impl RuntimeUpdates for PgComputerRepo {
    type Err = PgComputerError;

    #[tracing::instrument(name = "computer.runtime_update.request", skip_all, fields(%computer), err)]
    async fn request_runtime_update(
        &self,
        computer: ComputerId,
        bundle: &RuntimeBundle,
    ) -> Result<Option<Uuid>, PgComputerError> {
        if !bundle.valid() {
            return Ok(None);
        }
        let mut tx = self.pool.begin().await?;
        // The row lock is shared with move creation and the image pass's
        // transition into its held phase. Read competing operations in the
        // next statement to see commits from other holders of that lock.
        let eligible = sqlx::query_scalar!(
            r#"
            SELECT computer.id FROM hosted_runtime computer
            JOIN hosted_runtime_host host ON host.id = computer.host_id
            WHERE computer.id = $1 AND computer.agent_user_id IS NOT NULL
              AND computer.hibernated_at IS NULL AND host.endpoint IS NOT NULL
              AND computer.state->'phase'->>'phase' = 'running'
            FOR UPDATE OF computer
            "#,
            computer.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        if eligible.is_none() {
            return Ok(None);
        }
        let id = sqlx::query_scalar!(
            r#"
            INSERT INTO agent_runtime_update (computer_id, version, digest, source_url, id)
            SELECT $1, $2, $3, $4, $5
            WHERE NOT EXISTS (
                SELECT 1 FROM computer_move WHERE computer_id = $1
                  AND stage IN ('seeding', 'cutting_over', 'verifying', 'rolling_back')
            ) AND NOT EXISTS (
                SELECT 1 FROM image_upgrade_computer plan
                JOIN image_upgrade batch ON batch.id = plan.upgrade_id
                WHERE plan.computer_id = $1 AND batch.finished_at IS NULL
                  AND plan.state IN ('replacing', 'verifying', 'rolling_back')
            )
            ON CONFLICT (computer_id) WHERE outcome IS NULL DO NOTHING
            RETURNING id
            "#,
            computer.as_uuid(),
            bundle.version,
            bundle.digest,
            bundle.url,
            Uuid::now_v7(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(id)
    }

    async fn runtime_update_outcome(
        &self,
        id: Uuid,
    ) -> Result<Option<RuntimeUpdateOutcome>, PgComputerError> {
        let outcome =
            sqlx::query_scalar!("SELECT outcome FROM agent_runtime_update WHERE id = $1", id,)
                .fetch_one(&self.pool)
                .await?;
        outcome
            .map(|outcome| {
                outcome.parse().map_err(|_| {
                    PgComputerError::Corrupt("invalid runtime update outcome".to_owned())
                })
            })
            .transpose()
    }

    async fn claim_runtime_update(
        &self,
        holder: Uuid,
        lease: Duration,
    ) -> Result<Option<RuntimeUpdate>, PgComputerError> {
        let row = sqlx::query!(
            r#"
            WITH candidate AS (
                SELECT id, lease_holder IS NOT NULL AS attempted FROM agent_runtime_update
                WHERE outcome IS NULL AND lease_until <= now()
                ORDER BY lease_until, id LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            UPDATE agent_runtime_update item
            SET lease_holder = $1, lease_until = now() + $2::bigint * interval '1 second'
            FROM candidate WHERE item.id = candidate.id
            RETURNING item.id, item.computer_id, item.version, item.digest,
                      item.source_url AS "source_url!", item.deadline_at, candidate.attempted AS "attempted!"
            "#,
            holder,
            lease.num_seconds(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| RuntimeUpdate {
            id: row.id,
            computer: ComputerId::new_from_uuid(row.computer_id),
            bundle: RuntimeBundle {
                version: row.version,
                digest: row.digest,
                url: row.source_url,
            },
            deadline: row.deadline_at,
            attempted: row.attempted,
        }))
    }

    async fn finish_runtime_update(
        &self,
        holder: Uuid,
        id: Uuid,
        outcome: RuntimeUpdateOutcome,
    ) -> Result<bool, PgComputerError> {
        let updated = sqlx::query!(
            r#"
            UPDATE agent_runtime_update SET outcome = $3, source_url = NULL, lease_holder = NULL
            WHERE id = $1 AND lease_holder = $2 AND lease_until > now() AND outcome IS NULL
            "#,
            id,
            holder,
            outcome.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(updated.rows_affected() == 1)
    }
}
