//! Concurrent source id lookups through the function production calls: the
//! compiled library has its cache on, unlike the crate's unit tests. Every test
//! uses its own user ids because that cache is shared by the whole test binary.

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use entity_access::outbound::get_user_source_ids;
use futures::future::join_all;
use macro_user_id::user_id::MacroUserId;
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};

/// A pool that counts connection checkouts. The lookup is one statement and a
/// statement checks out one connection, so the count is the number of lookups
/// that reached the database.
async fn counting_pool(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> sqlx::Result<(PgPool, Arc<AtomicUsize>)> {
    let checkouts = Arc::new(AtomicUsize::new(0));
    let new_connections = Arc::clone(&checkouts);
    let reused_connections = Arc::clone(&checkouts);

    let pool = options
        .after_connect(move |_, _| {
            let checkouts = Arc::clone(&new_connections);
            Box::pin(async move {
                checkouts.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        })
        .before_acquire(move |_, _| {
            let checkouts = Arc::clone(&reused_connections);
            Box::pin(async move {
                checkouts.fetch_add(1, Ordering::SeqCst);
                Ok(true)
            })
        })
        .connect_with(connect)
        .await?;

    Ok((pool, checkouts))
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn concurrent_identical_source_id_lookups_run_the_query_once(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ('macro|sources-once@example.test', '7e000000-0000-0000-0000-000000000001', 'member');
        COMMIT;
        "#,
    )
    .execute(&pool)
    .await?;
    let before = checkouts.load(Ordering::SeqCst);
    let user = MacroUserId::parse_from_str("macro|sources-once@example.test")?.lowercase();
    let expected = vec![
        "7e000000-0000-0000-0000-000000000001".to_string(),
        "macro|sources-once@example.test".to_string(),
    ];

    let lookups = (0..20).map(|_| get_user_source_ids(&pool, Some(&user)));
    for source_ids in join_all(lookups).await {
        assert_eq!(source_ids?.0, expected);
    }
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 1);

    // The ten second cache still answers the next caller without a statement.
    let cached = get_user_source_ids(&pool, Some(&user)).await?;
    assert_eq!(cached.0, expected);
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 1);

    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn source_id_lookups_for_other_users_stay_separate(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    let before = checkouts.load(Ordering::SeqCst);
    let user_a = MacroUserId::parse_from_str("macro|sources-separate-a@example.test")?.lowercase();
    let user_b = MacroUserId::parse_from_str("macro|sources-separate-b@example.test")?.lowercase();

    let (a_sources, b_sources) = tokio::join!(
        get_user_source_ids(&pool, Some(&user_a)),
        get_user_source_ids(&pool, Some(&user_b)),
    );

    assert_eq!(a_sources?.0, vec!["macro|sources-separate-a@example.test"]);
    assert_eq!(b_sources?.0, vec!["macro|sources-separate-b@example.test"]);
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 2);

    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_failed_source_id_lookup_fails_every_waiting_caller_and_the_next_one_runs_again(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    sqlx::raw_sql("ALTER TABLE team_user RENAME TO team_user_moved")
        .execute(&pool)
        .await?;
    let before = checkouts.load(Ordering::SeqCst);
    let user = MacroUserId::parse_from_str("macro|sources-failed@example.test")?.lowercase();

    let lookups = (0..5).map(|_| get_user_source_ids(&pool, Some(&user)));
    for source_ids in join_all(lookups).await {
        let error = source_ids.expect_err("team_user is missing");
        assert!(error.downcast_ref::<Arc<sqlx::Error>>().is_some());
    }
    assert_eq!(checkouts.load(Ordering::SeqCst) - before, 1);

    sqlx::raw_sql("ALTER TABLE team_user_moved RENAME TO team_user")
        .execute(&pool)
        .await?;

    let source_ids = get_user_source_ids(&pool, Some(&user)).await?;
    assert_eq!(source_ids.0, vec!["macro|sources-failed@example.test"]);

    Ok(())
}
