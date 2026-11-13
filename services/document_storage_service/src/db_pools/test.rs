use std::time::Duration;

use macro_env::Environment;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use super::{
    ProbeOutcome, primary_limits, readonly_limits, replica_session_budget,
    replica_sessions_at_full_overlap, time_acquire,
};

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
    let (waited, outcome) = time_acquire(&pool).await;

    assert_eq!(outcome, ProbeOutcome::TimedOut);
    assert!(waited >= acquire_timeout);

    drop(held);
    let (_, outcome) = time_acquire(&pool).await;

    assert_eq!(outcome, ProbeOutcome::Acquired);
}
