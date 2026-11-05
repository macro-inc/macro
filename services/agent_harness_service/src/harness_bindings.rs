//! Postgres adapters for harness-keyed runtime routing.
//!
//! Composition-root adapters: [`PgHarnessBindings`] answers "which registered
//! harness serves this bot right now" for session binding, and
//! [`PgHarnessPresence`] writes the attach/detach bookkeeping the harness
//! settings page reads connection state from: one leased row per connection, so
//! replicas that see a harness's sockets end out of order cannot overwrite each
//! other's answer.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::schema::v1::SessionId;
use agent_harness::domain::ports::{HarnessBindings, HarnessPresence, RuntimeConnectionId};
use agent_session::domain::model::{AgentSessionId, ReplicaId};
use bot_id::BotId;
use harness_id::HarnessId;
use sqlx::PgPool;
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// How long a connection counts as live without a renewal. Three missed
/// renewals: a slow write does not flip a harness offline, and a crashed
/// replica's connections end within half a minute.
const RUNTIME_CONNECTION_LEASE: Duration = Duration::from_secs(30);

/// How often a replica renews the leases of the connections it holds.
pub const RUNTIME_CONNECTION_RENEW_EVERY: Duration = Duration::from_secs(10);

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

    async fn sessions_on_harness(
        &self,
        harness: HarnessId,
        acp_sessions: &[SessionId],
    ) -> anyhow::Result<Vec<AgentSessionId>> {
        let acp_sessions: Vec<String> = acp_sessions
            .iter()
            .map(|session| session.to_string())
            .collect();
        let ids = sqlx::query_scalar!(
            r#"
            SELECT s.id
            FROM agent_session s
            JOIN agent_configs ac ON ac.bot_id = s.bot_id
            JOIN harnesses h ON h.id = ac.harness_id
            WHERE ac.harness_id = $1
              AND h.deleted_at IS NULL
              AND s.acp_session_id = ANY($2)
            "#,
            harness.as_uuid(),
            &acp_sessions,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(ids.into_iter().map(AgentSessionId::new_from_uuid).collect())
    }
}

/// [`HarnessPresence`] over the `harness_runtime_connection` table, kept in step
/// with the `harnesses` presence timestamps.
pub struct PgHarnessPresence {
    pool: PgPool,
    replica: ReplicaId,
}

impl PgHarnessPresence {
    /// Wrap a pool, writing as `replica`.
    pub fn new(pool: PgPool, replica: ReplicaId) -> Self {
        Self { pool, replica }
    }
}

impl HarnessPresence for PgHarnessPresence {
    fn connected(
        self: Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let span = tracing::info_span!(
            "harness.presence.connected",
            %harness,
            %connection,
            replica = %self.replica,
        );
        Box::pin(
            async move {
                // Lapsed rows go here rather than on a timer: until a harness
                // dials again they are what says its last replica died.
                let result = sqlx::query!(
                    r#"
                    WITH reaped AS (
                        DELETE FROM harness_runtime_connection
                        WHERE harness_id = $1 AND lease_expires_at <= now()
                    ), added AS (
                        INSERT INTO harness_runtime_connection
                            (harness_id, id, replica_id, lease_expires_at)
                        VALUES ($1, $2, $3, now() + make_interval(secs => $4))
                        ON CONFLICT (harness_id, id) DO NOTHING
                    )
                    UPDATE harnesses SET last_connected_at = now() WHERE id = $1
                    "#,
                    harness.as_uuid(),
                    connection.as_uuid(),
                    self.replica.as_uuid(),
                    RUNTIME_CONNECTION_LEASE.as_secs_f64(),
                )
                .execute(&self.pool)
                .await;
                match result {
                    Ok(_) => tracing::info!(
                        telemetry_event = "harness_runtime_connected",
                        %harness,
                        %connection,
                        replica = %self.replica,
                        "recorded a harness runtime connection"
                    ),
                    Err(error) => {
                        tracing::error!(error = ?error, %harness, %connection, "failed to record harness attach");
                    }
                }
            }
            .instrument(span),
        )
    }

    fn disconnected(
        self: Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let span = tracing::info_span!(
            "harness.presence.disconnected",
            %harness,
            %connection,
            replica = %self.replica,
        );
        Box::pin(
            async move {
                // The stamp is what a reader without these rows goes by, so it
                // moves only when this was the harness's last live connection.
                let result = sqlx::query!(
                    r#"
                    WITH removed AS (
                        DELETE FROM harness_runtime_connection
                        WHERE harness_id = $1 AND (id = $2 OR lease_expires_at <= now())
                        RETURNING id, connected_at
                    ), others AS (
                        SELECT count(*) AS live
                        FROM harness_runtime_connection
                        WHERE harness_id = $1 AND id <> $2 AND lease_expires_at > now()
                    ), stamped AS (
                        UPDATE harnesses SET last_disconnected_at = now()
                        WHERE id = $1 AND (SELECT live FROM others) = 0
                    )
                    SELECT
                        (SELECT live FROM others) AS "other_live_connections!",
                        (
                            SELECT (extract(epoch FROM now() - connected_at) * 1000)::bigint
                            FROM removed
                            WHERE id = $2
                        ) AS connected_for_ms
                    "#,
                    harness.as_uuid(),
                    connection.as_uuid(),
                )
                .fetch_one(&self.pool)
                .await;
                match result {
                    Ok(closed) => tracing::info!(
                        telemetry_event = "harness_runtime_disconnected",
                        %harness,
                        %connection,
                        replica = %self.replica,
                        other_live_connections = closed.other_live_connections,
                        connected_for_ms = closed.connected_for_ms,
                        "recorded a closed harness runtime connection"
                    ),
                    Err(error) => {
                        tracing::error!(error = ?error, %harness, %connection, "failed to record harness detach");
                    }
                }
            }
            .instrument(span),
        )
    }

    fn renew(
        self: Arc<Self>,
        live: Vec<(HarnessId, RuntimeConnectionId)>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            let (harnesses, connections): (Vec<_>, Vec<_>) = live
                .into_iter()
                .map(|(harness, connection)| (harness.as_uuid(), connection.as_uuid()))
                .unzip();
            // An upsert, so a connection whose attach write failed, or whose
            // lapsed row was reaped while this process stalled, comes back.
            let renewed = sqlx::query!(
                r#"
                INSERT INTO harness_runtime_connection
                    (harness_id, id, replica_id, lease_expires_at)
                SELECT live.harness_id, live.id, $3, now() + make_interval(secs => $4)
                FROM UNNEST($1::uuid[], $2::uuid[]) AS live(harness_id, id)
                JOIN harnesses ON harnesses.id = live.harness_id
                ON CONFLICT (harness_id, id) DO UPDATE
                SET lease_expires_at = EXCLUDED.lease_expires_at
                RETURNING harness_id, id, (xmax = 0) AS "restored!"
                "#,
                &harnesses,
                &connections,
                self.replica.as_uuid(),
                RUNTIME_CONNECTION_LEASE.as_secs_f64(),
            )
            .fetch_all(&self.pool)
            .await;
            match renewed {
                Ok(renewed) => {
                    for row in renewed.into_iter().filter(|row| row.restored) {
                        tracing::warn!(
                            telemetry_event = "harness_runtime_lease_restored",
                            harness = %row.harness_id,
                            connection = %row.id,
                            replica = %self.replica,
                            "a held harness runtime connection had no presence row"
                        );
                    }
                }
                Err(error) => {
                    tracing::warn!(error = ?error, replica = %self.replica, "failed to renew harness runtime leases");
                }
            }
        })
    }
}
