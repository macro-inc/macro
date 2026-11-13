use std::time::Duration;

use macro_env::Environment;
use sqlx::{
    ConnectOptions,
    postgres::{PgConnectOptions, PgPoolOptions},
};

use super::{
    ProbeOutcome, connect_options, connect_readonly, connection_wait, primary_limits,
    readonly_limits,
};

/// A rolling deployment starts a full replacement set before the old tasks
/// stop, so twice the autoscaling maximum can hold connections at once.
const ROLLING_DEPLOYMENT_OVERLAP: u32 = 2;

/// The most tasks autoscaling runs: `maxCapacity` in
/// `infra/stacks/cloud-storage-service/cloud-storage-service.ts`.
fn autoscaling_max_tasks(environment: Environment) -> u32 {
    match environment {
        Environment::Production => 7,
        Environment::Develop => 3,
        Environment::Local => 1,
    }
}

/// The most read replica sessions this service may hold, across every task
/// and through a rolling deployment. The arithmetic and the replica's other
/// clients are in `docs/development/infrastructure.md`.
fn replica_session_budget(environment: Environment) -> u32 {
    match environment {
        Environment::Production => 350,
        Environment::Develop => 120,
        Environment::Local => 100,
    }
}

fn replica_sessions_at_full_overlap(environment: Environment) -> u32 {
    readonly_limits(environment).max_connections
        * autoscaling_max_tasks(environment)
        * ROLLING_DEPLOYMENT_OVERLAP
}

#[test]
fn production_readers_stay_inside_the_replica_budget_through_a_rolling_deployment() {
    assert_eq!(
        replica_sessions_at_full_overlap(Environment::Production),
        350
    );
    assert!(
        replica_sessions_at_full_overlap(Environment::Production)
            <= replica_session_budget(Environment::Production)
    );
}

#[test]
fn develop_readers_stay_inside_the_replica_budget_through_a_rolling_deployment() {
    assert_eq!(replica_sessions_at_full_overlap(Environment::Develop), 120);
    assert!(
        replica_sessions_at_full_overlap(Environment::Develop)
            <= replica_session_budget(Environment::Develop)
    );
}

#[test]
fn production_reader_limits_are_set_apart_from_the_primary() {
    let primary = primary_limits(Environment::Production);
    let readonly = readonly_limits(Environment::Production);

    assert_eq!((primary.min_connections, primary.max_connections), (10, 50));
    assert_eq!(primary.acquire_timeout, Duration::from_secs(30));
    assert_eq!(
        (readonly.min_connections, readonly.max_connections),
        (5, 25)
    );
    assert_eq!(readonly.acquire_timeout, Duration::from_secs(10));
}

#[test]
fn sessions_carry_the_service_name() {
    let options = connect_options("postgres://user@localhost/macrodb").unwrap();

    assert_eq!(
        options.get_application_name(),
        Some("document_storage_service")
    );
}

#[sqlx::test(migrations = false)]
async fn probe_reports_the_wait_of_a_full_pool_as_a_timeout(
    _pool_options: PgPoolOptions,
    connect_options: PgConnectOptions,
) {
    let acquire_timeout = Duration::from_secs(2);
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(acquire_timeout)
        .connect_with(connect_options)
        .await
        .unwrap();

    let held = pool.acquire().await.unwrap();
    let (waited, outcome) = connection_wait(&pool).await;

    assert_eq!(outcome, ProbeOutcome::TimedOut);
    assert!(waited >= acquire_timeout);

    drop(held);
    let (_, outcome) = connection_wait(&pool).await;

    assert_eq!(outcome, ProbeOutcome::Acquired);
}

#[sqlx::test(migrations = false)]
async fn probe_leaves_an_idle_connection_in_the_pool(
    _pool_options: PgPoolOptions,
    connect_options: PgConnectOptions,
) {
    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .unwrap();
    assert_eq!(pool.num_idle(), 1);

    let (waited, outcome) = connection_wait(&pool).await;

    assert_eq!((waited, outcome), (Duration::ZERO, ProbeOutcome::Acquired));
}

#[tokio::test]
async fn an_unreachable_replica_fails_the_readonly_connection() {
    let result = connect_readonly(
        "postgres://user@127.0.0.1:1/macrodb",
        readonly_limits(Environment::Production),
    )
    .await;

    assert!(result.is_err());
}

#[sqlx::test(migrations = false)]
async fn a_reachable_replica_gets_a_pool_with_the_readonly_limits(
    _pool_options: PgPoolOptions,
    connect_options: PgConnectOptions,
) {
    let pool = connect_readonly(
        connect_options.to_url_lossy().as_str(),
        readonly_limits(Environment::Production),
    )
    .await
    .unwrap();

    assert_eq!(pool.options().get_max_connections(), 25);
    assert_eq!(
        pool.options().get_acquire_timeout(),
        Duration::from_secs(10)
    );
    pool.acquire().await.unwrap();
}
