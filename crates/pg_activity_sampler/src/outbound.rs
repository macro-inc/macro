//! `pg_stat_activity` reads on a dedicated connection.
//!
//! Replicas elect one sampler with the session advisory lock
//! `hashtextextended('pg_activity_sampler', 0)`. The leader keeps its
//! connection, and so the lock, between samples; a follower connects, fails
//! the lock and disconnects, so the fleet holds one sampler connection. When
//! the leader's connection drops, Postgres frees the lock and another replica
//! takes it on its next tick. A connection through RDS Proxy is pinned by the
//! lock; if the proxy still drops it, a tick is skipped or sampled twice.

use std::time::Duration;

use sqlx::postgres::PgConnectOptions;
use sqlx::{ConnectOptions, Connection, PgConnection};

use crate::domain::{ActivitySource, LongTransaction, Sample, SampleError};

#[cfg(test)]
mod test;

/// Most sessions logged per sample, to bound log volume.
const MAX_SESSIONS: i64 = 50;

impl From<sqlx::Error> for SampleError {
    fn from(error: sqlx::Error) -> Self {
        SampleError(Box::new(error))
    }
}

/// Samples the database `options` points at, once this replica holds the
/// sampler lock.
pub struct PgActivitySource {
    options: PgConnectOptions,
    leader: Option<PgConnection>,
}

impl PgActivitySource {
    pub fn new(options: PgConnectOptions) -> Self {
        PgActivitySource {
            options,
            leader: None,
        }
    }
}

impl ActivitySource for PgActivitySource {
    async fn long_transactions(&mut self, older_than: Duration) -> Result<Sample, SampleError> {
        let connection = match self.leader.as_mut() {
            Some(connection) => connection,
            None => {
                let mut connection = self.options.connect().await?;
                let leader = sqlx::query_scalar!(
                    r#"SELECT pg_try_advisory_lock(hashtextextended('pg_activity_sampler', 0)) AS "leader!""#
                )
                .fetch_one(&mut connection)
                .await?;
                if !leader {
                    connection.close().await?;
                    return Ok(Sample::NotLeader);
                }
                self.leader.insert(connection)
            }
        };
        let sessions = read_long_transactions(connection, older_than).await;
        if sessions.is_err() {
            // Dropping the connection releases the lock for another replica.
            self.leader = None;
        }
        Ok(Sample::Sessions(sessions?))
    }
}

async fn read_long_transactions(
    connection: &mut PgConnection,
    older_than: Duration,
) -> Result<Vec<LongTransaction>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            pid AS "pid!",
            COALESCE(application_name, '') AS "application_name!",
            usename::text AS db_user,
            state,
            EXTRACT(EPOCH FROM now() - xact_start)::float8 AS "transaction_age_secs!",
            EXTRACT(EPOCH FROM now() - state_change)::float8 AS state_age_secs,
            wait_event_type,
            wait_event,
            query
        FROM pg_stat_activity
        WHERE datname = current_database()
            AND backend_type = 'client backend'
            AND pid <> pg_backend_pid()
            AND xact_start < now() - make_interval(secs => $1)
        ORDER BY xact_start
        LIMIT $2
        "#,
        older_than.as_secs_f64(),
        MAX_SESSIONS,
    )
    .fetch_all(connection)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| LongTransaction {
            pid: row.pid,
            application_name: row.application_name,
            db_user: row.db_user,
            state: row.state,
            transaction_age: seconds(row.transaction_age_secs),
            state_age: row.state_age_secs.map(seconds),
            wait_event_type: row.wait_event_type,
            wait_event: row.wait_event,
            query: row.query,
        })
        .collect())
}

fn seconds(value: f64) -> Duration {
    Duration::from_secs_f64(value.max(0.0))
}
