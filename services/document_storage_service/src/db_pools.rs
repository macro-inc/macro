//! Connection limits for the service's primary and read replica pools, and the
//! metrics that show how full each pool is and how long it makes callers wait.

use std::{
    str::FromStr,
    time::{Duration, Instant},
};

use macro_env::Environment;
use opentelemetry::{
    KeyValue,
    metrics::{Gauge, Histogram},
};
use sqlx::{
    ConnectOptions, Connection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use tokio_util::sync::CancellationToken;

const PROBE_INTERVAL: Duration = Duration::from_secs(1);

const POOL_NAME: &str = "db.client.connection.pool.name";
const CONNECTION_STATE: &str = "db.client.connection.state";
const PROBE_OUTCOME: &str = "outcome";

const USED_CONNECTIONS_BOUNDARIES: [f64; 13] = [
    0.0, 1.0, 2.0, 5.0, 10.0, 15.0, 20.0, 25.0, 30.0, 40.0, 50.0, 75.0, 100.0,
];

const WAIT_TIME_BOUNDARIES_SECONDS: [f64; 13] = [
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PoolLimits {
    pub(crate) min_connections: u32,
    pub(crate) max_connections: u32,
    /// How long a caller waits for a connection before its query fails.
    pub(crate) acquire_timeout: Duration,
}

/// Postgres shows this on each of the service's sessions, so a database's
/// sessions can be attributed to the service.
const APPLICATION_NAME: &str = "document_storage_service";

/// sqlx's default, written out.
const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(30);

const READONLY_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a starting task waits for the replica before it reads the
/// primary instead: what the pool's own thirty-second timeout allowed before.
const READONLY_STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn connect_options(database_url: &str) -> Result<PgConnectOptions, sqlx::Error> {
    Ok(PgConnectOptions::from_str(database_url)?.application_name(APPLICATION_NAME))
}

/// Per task. Normally each task runs about one query at a time; a larger
/// max only lets a slow database pile up more sessions.
pub(crate) fn primary_limits(environment: Environment) -> PoolLimits {
    let (min_connections, max_connections) = match environment {
        Environment::Production => (10, 50),
        Environment::Develop => (25, 100),
        Environment::Local => (15, 50),
    };

    PoolLimits {
        min_connections,
        max_connections,
        acquire_timeout: ACQUIRE_TIMEOUT,
    }
}

/// Per task, against the read replica. The replica is shared, so the cap is
/// what keeps this service inside its replica session budget however many
/// tasks run (checked in `db_pools/test.rs`): reads past the cap queue in the
/// task instead of adding sessions to a replica that is already slow.
///
/// A queued read fails after ten seconds, before the web app gives up on a
/// Soup request at twelve, and is never retried on the primary.
pub(crate) fn readonly_limits(environment: Environment) -> PoolLimits {
    let (min_connections, max_connections) = match environment {
        // 7 tasks hold at most 175 sessions, 14 tasks in a rolling deployment 350.
        Environment::Production => (5, 25),
        // 3 tasks hold at most 60 sessions, 6 tasks in a rolling deployment 120.
        Environment::Develop => (2, 20),
        Environment::Local => (15, 50),
    };

    PoolLimits {
        min_connections,
        max_connections,
        acquire_timeout: READONLY_ACQUIRE_TIMEOUT,
    }
}

/// Open the readonly pool once one connection to the replica succeeds.
///
/// sqlx opens a pool's minimum connections one after another inside a single
/// acquire timeout, so a slow replica could fail the ten-second timeout at
/// startup while every connection worked. Reachability is checked with one
/// connection instead, and the pool fills its minimum in the background.
pub(crate) async fn connect_readonly(
    database_url: &str,
    limits: PoolLimits,
) -> Result<PgPool, sqlx::Error> {
    let options = connect_options(database_url)?;

    tokio::time::timeout(READONLY_STARTUP_TIMEOUT, options.connect())
        .await
        .map_err(|_| sqlx::Error::PoolTimedOut)??
        .close()
        .await?;

    Ok(PgPoolOptions::new()
        .min_connections(limits.min_connections)
        .max_connections(limits.max_connections)
        .acquire_timeout(limits.acquire_timeout)
        .connect_lazy_with(options))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProbeOutcome {
    Acquired,
    TimedOut,
    Failed,
}

impl ProbeOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Acquired => "acquired",
            Self::TimedOut => "timed_out",
            Self::Failed => "failed",
        }
    }
}

/// How long a query arriving now would queue for a connection.
///
/// An idle connection means no queue, and is left alone: checking it out
/// would reset its idle time every second, so the pool would never shrink
/// after a burst. With none idle, wait in line the way a query does, then
/// give the connection straight back.
pub(crate) async fn connection_wait(pool: &PgPool) -> (Duration, ProbeOutcome) {
    if pool.num_idle() > 0 {
        return (Duration::ZERO, ProbeOutcome::Acquired);
    }

    let started = Instant::now();

    let outcome = match pool.acquire().await {
        Ok(_connection) => ProbeOutcome::Acquired,
        Err(sqlx::Error::PoolTimedOut) => ProbeOutcome::TimedOut,
        Err(_) => ProbeOutcome::Failed,
    };

    (started.elapsed(), outcome)
}

struct PoolInstruments {
    connections: Gauge<u64>,
    max_connections: Gauge<u64>,
    used_connections: Histogram<u64>,
    wait_time: Histogram<f64>,
}

impl PoolInstruments {
    fn new() -> Self {
        let meter = opentelemetry::global::meter("document_storage_service");

        Self {
            connections: meter
                .u64_gauge("db.client.connection.count")
                .with_description("Open connections in the pool, by state")
                .build(),
            max_connections: meter
                .u64_gauge("db.client.connection.max")
                .with_description("The pool's connection limit")
                .build(),
            // The gauges export one reading a minute; this keeps every
            // second's, so short bursts show in its percentiles and maximum.
            used_connections: meter
                .u64_histogram("db.client.connection.used")
                .with_description("Connections in use, sampled once a second")
                .with_boundaries(USED_CONNECTIONS_BOUNDARIES.to_vec())
                .build(),
            wait_time: meter
                .f64_histogram("db.client.connection.wait_time")
                .with_description("Time a once-a-second probe queued for a pooled connection")
                .with_unit("s")
                .with_boundaries(WAIT_TIME_BOUNDARIES_SECONDS.to_vec())
                .build(),
        }
    }
}

/// Report `pool`'s occupancy and connection wait once a second until `cancel`
/// fires.
///
/// sqlx waits for a connection inside each query and exposes no per-query
/// hook, so the wait is sampled: with every connection in use, the probe
/// queues behind the same callers a query would. Occupancy is reported on its
/// own schedule, so a probe stuck in a full pool's queue does not pause it.
pub(crate) async fn report_usage(pool_name: &'static str, pool: PgPool, cancel: CancellationToken) {
    let instruments = PoolInstruments::new();
    let pool_attribute = KeyValue::new(POOL_NAME, pool_name);

    tokio::join!(
        report_occupancy(&instruments, &pool_attribute, &pool, &cancel),
        report_connection_wait(&instruments, &pool_attribute, &pool, &cancel),
    );
}

fn probe_ticker() -> tokio::time::Interval {
    let mut ticker = tokio::time::interval(PROBE_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ticker
}

async fn report_occupancy(
    instruments: &PoolInstruments,
    pool_attribute: &KeyValue,
    pool: &PgPool,
    cancel: &CancellationToken,
) {
    let idle_attributes = [
        pool_attribute.clone(),
        KeyValue::new(CONNECTION_STATE, "idle"),
    ];
    let used_attributes = [
        pool_attribute.clone(),
        KeyValue::new(CONNECTION_STATE, "used"),
    ];
    let mut ticker = probe_ticker();

    loop {
        tokio::select! {
            () = cancel.cancelled() => break,
            _ = ticker.tick() => {}
        }

        let idle = u64::try_from(pool.num_idle()).unwrap_or(u64::MAX);
        let used = u64::from(pool.size()).saturating_sub(idle);
        instruments.connections.record(idle, &idle_attributes);
        instruments.connections.record(used, &used_attributes);
        instruments
            .used_connections
            .record(used, std::slice::from_ref(pool_attribute));
        instruments.max_connections.record(
            u64::from(pool.options().get_max_connections()),
            std::slice::from_ref(pool_attribute),
        );
    }
}

async fn report_connection_wait(
    instruments: &PoolInstruments,
    pool_attribute: &KeyValue,
    pool: &PgPool,
    cancel: &CancellationToken,
) {
    let mut ticker = probe_ticker();

    loop {
        tokio::select! {
            () = cancel.cancelled() => break,
            _ = ticker.tick() => {}
        }

        let (waited, outcome) = tokio::select! {
            () = cancel.cancelled() => break,
            sample = connection_wait(pool) => sample,
        };
        instruments.wait_time.record(
            waited.as_secs_f64(),
            &[
                pool_attribute.clone(),
                KeyValue::new(PROBE_OUTCOME, outcome.as_str()),
            ],
        );
    }
}

#[cfg(test)]
mod test;
