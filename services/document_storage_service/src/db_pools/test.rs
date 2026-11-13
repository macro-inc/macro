use std::time::Duration;

use macro_env::Environment;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use super::{ProbeOutcome, connect_options, connection_wait, primary_limits, readonly_limits};

#[test]
fn reader_limits_are_set_apart_from_the_primary() {
    let primary = primary_limits(Environment::Develop);
    let readonly = readonly_limits(Environment::Develop);

    assert_eq!(
        (primary.min_connections, primary.max_connections),
        (25, 100)
    );
    assert_eq!(
        (readonly.min_connections, readonly.max_connections),
        (2, 20)
    );
    assert_eq!(readonly.acquire_timeout, Duration::from_secs(30));
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
