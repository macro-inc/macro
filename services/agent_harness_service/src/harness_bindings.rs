//! Postgres adapters for harness-keyed runtime routing.
//!
//! Composition-root adapters: [`PgHarnessBindings`] answers "which registered
//! harness serves this bot right now" for session binding, and
//! [`PgRuntimeLease`] owns the cluster-wide runtime socket lease and updates
//! UI presence from its exact-token transitions.

use std::future::Future;
use std::pin::Pin;

use agent_harness::domain::model::RuntimeOwner;
use agent_harness::domain::ports::{HarnessBindings, RuntimeLease};
use agent_session::domain::model::{ReplicaAddress, ReplicaId};
use bot_id::BotId;
use harness_id::HarnessId;
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// [`HarnessBindings`] over the `agent_configs` table.
#[derive(Clone)]
pub struct PgHarnessBindings {
    pool: PgPool,
}

impl PgHarnessBindings {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl HarnessBindings for PgHarnessBindings {
    async fn harness_for(&self, bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        let harness_id = sqlx::query_scalar!(
            r#"
            SELECT ac.harness_id
            FROM agent_configs ac
            JOIN harnesses h ON h.id = ac.harness_id
            WHERE ac.bot_id = $1 AND h.deleted_at IS NULL
            "#,
            bot.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(harness_id.flatten().map(HarnessId::new_from_uuid))
    }
}

/// [`RuntimeLease`] over the durable harness runtime owner row.
#[derive(Clone)]
pub struct PgRuntimeLease {
    pool: PgPool,
}

impl PgRuntimeLease {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Remove owners whose replica heartbeat expired and record disconnects.
    pub async fn expire_stale(&self) -> anyhow::Result<()> {
        sqlx::query!(
            "WITH expired AS ( \
               DELETE FROM harness_runtime_lease lease \
               WHERE NOT EXISTS ( \
                 SELECT 1 FROM harness_replica replica \
                 WHERE replica.id = lease.replica_id \
                   AND replica.last_heartbeat_at > now() - interval '30 seconds' \
               ) RETURNING harness_id, replica_id \
             ), fenced AS ( \
               UPDATE agent_session session SET manager_replica_id = NULL \
               FROM expired \
               WHERE session.manager_replica_id = expired.replica_id \
                 AND EXISTS ( \
                   SELECT 1 FROM agent_configs config \
                   WHERE config.bot_id = session.bot_id \
                     AND config.harness_id = expired.harness_id \
                 ) \
             ) UPDATE harnesses SET last_disconnected_at = now() \
               WHERE id IN (SELECT harness_id FROM expired)"
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

impl RuntimeLease for PgRuntimeLease {
    fn claim(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        let pool = self.pool.clone();
        Box::pin(async move {
            let mut transaction = pool.begin().await?;
            let previous = sqlx::query!(
                "SELECT replica_id, connection_id FROM harness_runtime_lease WHERE harness_id = $1 FOR UPDATE",
                harness.as_uuid(),
            )
            .fetch_optional(&mut *transaction)
            .await?;
            let claimed = sqlx::query!(
                r#"INSERT INTO harness_runtime_lease (harness_id, replica_id, connection_id)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (harness_id) DO UPDATE
                   SET replica_id = EXCLUDED.replica_id, connection_id = EXCLUDED.connection_id,
                       pending_until = now() + interval '5 seconds'
                   WHERE harness_runtime_lease.pending_until <= now()
                      OR NOT EXISTS (
                       SELECT 1 FROM harness_replica current
                       WHERE current.id = harness_runtime_lease.replica_id
                         AND current.last_heartbeat_at > now() - interval '30 seconds'
                   )"#,
                harness.as_uuid(),
                replica.as_uuid(),
                connection_id,
            )
            .execute(&mut *transaction)
            .await?
            .rows_affected()
                == 1;
            if claimed
                && previous.as_ref().is_some_and(|previous| {
                    previous.replica_id != replica.as_uuid()
                        || previous.connection_id != connection_id
                })
            {
                sqlx::query!(
                    "UPDATE agent_session session SET manager_replica_id = NULL \
                     WHERE session.manager_replica_id = $1 \
                       AND EXISTS ( \
                         SELECT 1 FROM agent_configs config \
                         WHERE config.bot_id = session.bot_id AND config.harness_id = $2 \
                       )",
                    previous.expect("checked above").replica_id,
                    harness.as_uuid(),
                )
                .execute(&mut *transaction)
                .await?;
            }
            transaction.commit().await?;
            Ok(claimed)
        })
    }

    fn activate(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        let pool = self.pool.clone();
        Box::pin(async move {
            let result = sqlx::query!(
                "WITH activated AS ( \
                   UPDATE harness_runtime_lease SET pending_until = 'infinity'::timestamptz \
                   WHERE harness_id = $1 AND replica_id = $2 AND connection_id = $3 \
                     AND pending_until > now() RETURNING harness_id \
                 ) UPDATE harnesses SET last_connected_at = now() \
                   WHERE id IN (SELECT harness_id FROM activated)",
                harness.as_uuid(),
                replica.as_uuid(),
                connection_id,
            )
            .execute(&pool)
            .await;
            Ok(result?.rows_affected() == 1)
        })
    }

    fn release(
        &self,
        harness: HarnessId,
        replica: ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> {
        let pool = self.pool.clone();
        Box::pin(async move {
            sqlx::query!(
                "WITH released AS ( \
                   DELETE FROM harness_runtime_lease \
                   WHERE harness_id = $1 AND replica_id = $2 AND connection_id = $3 \
                   RETURNING harness_id, replica_id \
                 ), fenced AS ( \
                   UPDATE agent_session session SET manager_replica_id = NULL \
                   FROM released \
                   WHERE session.manager_replica_id = released.replica_id \
                     AND EXISTS ( \
                       SELECT 1 FROM agent_configs config \
                       WHERE config.bot_id = session.bot_id \
                         AND config.harness_id = released.harness_id \
                     ) \
                 ) UPDATE harnesses SET last_disconnected_at = now() \
                   WHERE id IN (SELECT harness_id FROM released)",
                harness.as_uuid(),
                replica.as_uuid(),
                connection_id,
            )
            .execute(&pool)
            .await?;
            Ok(())
        })
    }

    fn owner(
        &self,
        harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Option<RuntimeOwner>>> + Send>> {
        let pool = self.pool.clone();
        Box::pin(async move {
            let owner = sqlx::query!(
                "SELECT lease.replica_id, lease.connection_id, replica.address, \
                        CASE WHEN lease.pending_until = 'infinity'::timestamptz \
                             THEN NULL ELSE lease.pending_until END AS pending_until \
                 FROM harness_runtime_lease lease \
                 JOIN harness_replica replica ON replica.id = lease.replica_id \
                 WHERE lease.harness_id = $1 \
                   AND replica.last_heartbeat_at > now() - interval '30 seconds' \
                   AND lease.pending_until > now()",
                harness.as_uuid(),
            )
            .fetch_optional(&pool)
            .await?;
            Ok(owner.map(|owner| RuntimeOwner {
                replica: ReplicaId::from_uuid(owner.replica_id),
                connection_id: owner.connection_id,
                pending_until: owner.pending_until,
                address: owner.address.map(ReplicaAddress::new),
            }))
        })
    }
}
