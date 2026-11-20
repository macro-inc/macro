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
use agent_harness::domain::model::{DORMANT_AFTER, ListedSessions, RuntimeAccessFacts};
use agent_harness::domain::ports::{
    ConnectionRecorded, HarnessBindings, HarnessConnection, HarnessPresence, RuntimeAccepts,
    RuntimeConnectionId,
};
use agent_session::domain::model::ReplicaId;
use bot_id::BotId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::pool::PoolConnection;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres};
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// How long a connection counts as live without a renewal. Three missed
/// renewals: a slow write does not flip a harness offline, and a crashed
/// replica's connections end within half a minute.
const RUNTIME_CONNECTION_LEASE: Duration = Duration::from_secs(30);

/// How often a replica renews the leases of the connections it holds.
pub const RUNTIME_CONNECTION_RENEW_EVERY: Duration = Duration::from_secs(10);

/// How long a renewal may take in all, waiting for its connection included.
/// Half the renewal period, so a stalled renewal ends before the next tick
/// and that one still lands well inside the lease.
const RENEWAL_TIMEOUT: Duration = Duration::from_secs(5);

/// A renewal's connection, closed on drop unless the renewal finished with
/// it. Returning a connection cut off mid-query to the pool pings it first,
/// with no bound, so a silent socket would hold the renewal pool's only
/// connection and fail every later renewal. sqlx bounds a close to 5 s.
struct CloseUnlessFinished {
    connection: PoolConnection<Postgres>,
    finished: bool,
}

impl CloseUnlessFinished {
    fn new(connection: PoolConnection<Postgres>) -> Self {
        Self {
            connection,
            finished: false,
        }
    }

    fn as_mut(&mut self) -> &mut PoolConnection<Postgres> {
        &mut self.connection
    }

    fn finish(&mut self) {
        self.finished = true;
    }
}

impl Drop for CloseUnlessFinished {
    fn drop(&mut self) {
        if !self.finished {
            self.connection.close_on_drop();
        }
    }
}

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
        use bots::domain::ports::HarnessAssignments;
        use harnesses::domain::ports::HarnessRepo;

        let assignment = bots::outbound::pg_bots_repo::PgBotsRepo::new(self.pool.clone());
        let Some(harness) = assignment.harness_for(bot).await? else {
            return Ok(None);
        };
        let repo = harnesses::outbound::pg_harness_repo::PgHarnessRepo::new(self.pool.clone());
        Ok(repo.get_harness(harness).await?.map(|harness| harness.id))
    }

    async fn access_facts(
        &self,
        bot: BotId,
        actor: Option<&MacroUserIdStr<'static>>,
    ) -> anyhow::Result<Option<RuntimeAccessFacts>> {
        let actor_id: Option<&str> = actor.map(|actor| actor.as_ref());
        let row = sqlx::query!(
            r#"
            SELECT
                h.name AS runtime_name,
                NOT ac.is_coding AS "resident!",
                agent_owner_can_run(ac.bot_id) AS "agent_owner_may_use!",
                harness_can_run(ac.harness_id, $2) AS "actor_may_use!"
            FROM agent_configs ac
            JOIN harnesses h ON h.id = ac.harness_id
            WHERE ac.bot_id = $1 AND h.deleted_at IS NULL
            "#,
            bot.as_uuid(),
            actor_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| RuntimeAccessFacts {
            runtime_name: row.runtime_name,
            resident: row.resident,
            agent_owner_may_use: row.agent_owner_may_use,
            actor_may_use: actor.map(|_| row.actor_may_use),
        }))
    }

    async fn sessions_on_harness(
        &self,
        harness: HarnessId,
        acp_sessions: &[SessionId],
    ) -> anyhow::Result<ListedSessions> {
        use agent_session::domain::ports::RuntimeSessionLookup;
        use bots::domain::ports::HarnessAssignments;
        use harnesses::domain::ports::HarnessRepo;

        let repo = harnesses::outbound::pg_harness_repo::PgHarnessRepo::new(self.pool.clone());
        if repo.get_harness(harness).await?.is_none() {
            return Ok(ListedSessions::default());
        }
        let assignments = bots::outbound::pg_bots_repo::PgBotsRepo::new(self.pool.clone());
        let bots = assignments.bots_on_harness(harness).await?;
        let sessions =
            agent_session::outbound::runtime_sessions::PgRuntimeSessions(self.pool.clone());
        let dormant_before = chrono::Utc::now() - DORMANT_AFTER;
        let mut listed = ListedSessions::default();
        for session in sessions
            .sessions_for_bots(&bots, acp_sessions, dormant_before)
            .await?
        {
            if session.dormant {
                listed.dormant += 1;
            } else {
                listed.live.push(session.id);
            }
        }
        Ok(listed)
    }
}

/// Take a harness's presence lock until the transaction ends.
///
/// Closing decides whether it was the last live connection by reading its peers'
/// rows. Without this, two simultaneous closes each count the other as live and
/// neither stamps the harness. `NO KEY` leaves renewals' foreign key checks free.
async fn lock_presence(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    harness: HarnessId,
) -> sqlx::Result<()> {
    sqlx::query_scalar!(
        r#"SELECT id FROM harnesses WHERE id = $1 FOR NO KEY UPDATE"#,
        harness.as_uuid(),
    )
    .fetch_optional(&mut **transaction)
    .await?;
    Ok(())
}

/// [`HarnessPresence`] over the `harness_runtime_connection` table, kept in step
/// with the `harnesses` presence timestamps.
pub struct PgHarnessPresence {
    pool: PgPool,
    /// One connection only renewals use. A renewal that queues for the shared
    /// pool behind a burst of other work lets every lease this replica holds
    /// lapse, and its live harnesses read offline.
    renewal_pool: PgPool,
    replica: ReplicaId,
}

impl PgHarnessPresence {
    /// Wrap a pool, writing as `replica`. Renewals get their own connection
    /// to the same database.
    pub fn new(pool: PgPool, replica: ReplicaId) -> Self {
        let statement_timeout = format!("{}ms", RENEWAL_TIMEOUT.as_millis());
        let renewal_pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(RENEWAL_TIMEOUT)
            .connect_lazy_with(
                pool.connect_options()
                    .as_ref()
                    .clone()
                    .options([("statement_timeout", statement_timeout.as_str())]),
            );
        Self {
            pool,
            renewal_pool,
            replica,
        }
    }
}

impl HarnessPresence for PgHarnessPresence {
    fn connected(
        self: Arc<Self>,
        harness: HarnessId,
        connection: RuntimeConnectionId,
        _accepts: RuntimeAccepts,
    ) -> Pin<Box<dyn Future<Output = ConnectionRecorded> + Send>> {
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
                let result = async {
                    let mut transaction = self.pool.begin().await?;
                    lock_presence(&mut transaction, harness).await?;
                    sqlx::query!(
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
                    .execute(&mut *transaction)
                    .await?;
                    transaction.commit().await
                }
                .await;
                match result {
                    Ok(()) => tracing::info!(
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
                // Presence itself never binds an agent.
                ConnectionRecorded::AgentsUnchanged
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
                let result = async {
                    let mut transaction = self.pool.begin().await?;
                    lock_presence(&mut transaction, harness).await?;
                    let closed = sqlx::query!(
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
                    .fetch_one(&mut *transaction)
                    .await?;
                    transaction.commit().await?;
                    Ok::<_, sqlx::Error>(closed)
                }
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
        live: Vec<HarnessConnection>,
    ) -> Pin<Box<dyn Future<Output = Vec<HarnessConnection>> + Send>> {
        let span = tracing::info_span!(
            "harness.presence.renew",
            replica = %self.replica,
            connections = live.len(),
            renewed = tracing::field::Empty,
            restored = tracing::field::Empty,
            error = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        Box::pin(async move {
            let (harnesses, connections): (Vec<_>, Vec<_>) = live
                .iter()
                .map(|(harness, connection)| (harness.as_uuid(), connection.as_uuid()))
                .unzip();
            // An upsert, so a connection whose attach write failed, or whose
            // lapsed row was reaped while this process stalled, comes back.
            let renewal = sqlx::query!(
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
            );
            let renewed = async {
                let mut connection =
                    CloseUnlessFinished::new(self.renewal_pool.acquire().await?);
                let rows = renewal.fetch_all(&mut **connection.as_mut()).await?;
                connection.finish();
                Ok::<_, sqlx::Error>(rows)
            };
            // The pool's own timeouts can't bound a socket that went silent.
            let renewed = match tokio::time::timeout(RENEWAL_TIMEOUT, renewed).await {
                Ok(Ok(renewed)) => renewed,
                Ok(Err(error)) => {
                    let span = tracing::Span::current();
                    span.record("error", tracing::field::display(&error));
                    span.record("otel.status_code", "ERROR");
                    tracing::warn!(error = ?error, replica = %self.replica, "failed to renew harness runtime leases");
                    return Vec::new();
                }
                // If the upsert committed just before the timeout, its restores
                // are lost and not undone; such a row lapses with its lease.
                Err(_) => {
                    let span = tracing::Span::current();
                    span.record("error", "timed out");
                    span.record("otel.status_code", "ERROR");
                    tracing::warn!(
                        timeout_ms = RENEWAL_TIMEOUT.as_millis(),
                        replica = %self.replica,
                        "harness runtime lease renewal timed out"
                    );
                    return Vec::new();
                }
            };
            tracing::Span::current().record("renewed", renewed.len());
            let restored: Vec<_> = renewed
                .into_iter()
                .filter(|row| row.restored)
                .map(|row| (row.harness_id, row.id))
                .collect();
            tracing::Span::current().record("restored", restored.len());
            for (harness, connection) in &restored {
                tracing::warn!(
                    telemetry_event = "harness_runtime_lease_restored",
                    %harness,
                    %connection,
                    replica = %self.replica,
                    "a renewed harness runtime connection had no presence row"
                );
            }
            live.into_iter()
                .filter(|(harness, connection)| {
                    restored.contains(&(harness.as_uuid(), connection.as_uuid()))
                })
                .collect()
        }
        .instrument(span))
    }
}
