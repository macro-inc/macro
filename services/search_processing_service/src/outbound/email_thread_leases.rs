//! Postgres advisory locks as email thread leases, the way agent sessions
//! lease theirs.

use std::time::Instant;

use opentelemetry::{KeyValue, metrics::Histogram};
use rootcause::Report;
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use uuid::Uuid;

use crate::domain::{
    email_index::{EmailThreadLeases, EmailWriter, GrantedThreads, LeasePool, LeaseWait},
    fence::ProjectionVersion,
};

/// Lock connections for the Kafka workers that write email: ten on the email
/// lane, and up to ten more on the live lane handling thread property events.
pub const LIVE_LOCK_CONNECTIONS: u32 = 20;

/// Longest a lease waits for another writer's locks: per lock
/// (`lock_timeout`) and for the whole statement (`statement_timeout`), since a
/// batch waits for each of its threads in turn. A holder works at most
/// [`crate::domain::email_index::LEASE_DEADLINE`] (120 s), so a longer wait
/// means locks that are not coming back; the attempt fails and retries.
const LEASE_WAIT_LIMIT: &str = "150s";

#[cfg(test)]
mod test;

/// Longest a release waits for the database to answer its rollback.
const RELEASE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

const METER_NAME: &str = "search_processing_service";
pub const LEASE_WAIT: &str = "search.index.lease_wait_ms";

/// [`LEASE_WAIT`] bucket bounds in ms: a free lease takes a few, a live write
/// behind a queue batch waits for the batch (9.8 s p95 in production on
/// 24 Nov), and nothing waits past the 150 s limit.
const LEASE_WAIT_BOUNDARIES_MS: [f64; 16] = [
    1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1_000.0, 2_500.0, 5_000.0, 10_000.0,
    30_000.0, 60_000.0, 150_000.0,
];

/// Leases email threads with transaction-scoped advisory locks on the
/// primary. The lock connections are their own pools, so writers waiting for
/// a lease never hold the connections other writers need to read, and bulk
/// writers never hold live writers' lock connections.
pub struct PgEmailThreadLeases {
    live: PgPool,
    bulk: PgPool,
    waits: Histogram<u64>,
}

impl PgEmailThreadLeases {
    /// `bulk_connections` should match the backfill gate's in-flight cap: each
    /// queue message or direct backfill write holds one lease.
    pub fn new(primary: PgConnectOptions, bulk_connections: u32) -> Self {
        let options = primary.options([
            ("lock_timeout", LEASE_WAIT_LIMIT),
            ("statement_timeout", LEASE_WAIT_LIMIT),
        ]);
        let pool = |connections| {
            PgPoolOptions::new()
                .max_connections(connections)
                .connect_lazy_with(options.clone())
        };
        Self {
            live: pool(LIVE_LOCK_CONNECTIONS),
            bulk: pool(bulk_connections),
            waits: opentelemetry::global::meter(METER_NAME)
                .u64_histogram(LEASE_WAIT)
                .with_unit("ms")
                .with_description(
                    "Time an email writer waited for a lock connection and for its threads' locks",
                )
                .with_boundaries(LEASE_WAIT_BOUNDARIES_MS.to_vec())
                .build(),
        }
    }

    fn record(&self, stage: &'static str, pool: LeasePool, writer: EmailWriter, ms: u64) {
        self.waits.record(
            ms,
            &[
                KeyValue::new("stage", stage),
                KeyValue::new("pool", <&'static str>::from(pool)),
                KeyValue::new("writer", <&'static str>::from(writer)),
            ],
        );
    }
}

fn millis(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

impl EmailThreadLeases for PgEmailThreadLeases {
    type Lease = sqlx::Transaction<'static, sqlx::Postgres>;

    #[tracing::instrument(
        name = "search.email.lease",
        err,
        skip_all,
        fields(
            threads = thread_ids.len(),
            pool = <&'static str>::from(pool),
            writer = <&'static str>::from(writer),
            connection_ms = tracing::field::Empty,
            lock_ms = tracing::field::Empty,
        )
    )]
    async fn lease(
        &self,
        thread_ids: &[Uuid],
        pool: LeasePool,
        writer: EmailWriter,
    ) -> Result<GrantedThreads<Self::Lease>, Report> {
        let started = Instant::now();
        let mut transaction = match pool {
            LeasePool::Live => self.live.begin(),
            LeasePool::Bulk => self.bulk.begin(),
        }
        .await?;
        let connection = started.elapsed();

        // Each thread's lock in the order of its key, so writers leasing
        // overlapping sets wait for each other instead of deadlocking. The
        // subquery's order holds because each lock is a function called per
        // row of it; the clock is read after the last lock is granted.
        let locking = Instant::now();
        let granted_at = sqlx::query_scalar!(
            r#"
            SELECT max(granted_at) AS "granted_at!"
            FROM (
                SELECT clock_timestamp() AS granted_at
                FROM (
                    SELECT DISTINCT hashtextextended('email-thread-search:' || thread_id::text, 0) AS lock_key
                    FROM unnest($1::uuid[]) AS thread_id
                    ORDER BY lock_key
                ) AS keys,
                LATERAL pg_advisory_xact_lock(keys.lock_key)
            ) AS granted
            "#,
            thread_ids,
        )
        .fetch_one(&mut *transaction)
        .await?;
        let lock = locking.elapsed();

        let span = tracing::Span::current();
        span.record("connection_ms", millis(connection));
        span.record("lock_ms", millis(lock));
        self.record("connection", pool, writer, millis(connection));
        self.record("lock", pool, writer, millis(lock));
        Ok(GrantedThreads {
            lease: transaction,
            version: ProjectionVersion::from_grant(granted_at)?,
            waited: LeaseWait { connection, lock },
        })
    }

    async fn release(&self, lease: Self::Lease) {
        // A rollback that fails, or a connection that stops answering, leaves
        // the connection to be closed, which releases the locks as well.
        match tokio::time::timeout(RELEASE_TIMEOUT, lease.rollback()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, "could not release email thread leases");
            }
            Err(_) => tracing::warn!("releasing email thread leases timed out"),
        }
    }
}
