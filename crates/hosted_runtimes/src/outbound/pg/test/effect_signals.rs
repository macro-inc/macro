use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_bought_computer_wakes_the_fleet_worker_once_its_creation_commits(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let tracker = tokio_util::task::TaskTracker::new();
    let shutdown = tokio_util::sync::CancellationToken::new();
    let signals = PgEffectSignals::listen(pool, &tracker, shutdown.clone()).await;

    bought(&repo, 1).await;

    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        signals.fleet_effect_queued(),
    )
    .await
    .expect("the queued Create effect wakes the fleet worker");
    shutdown.cancel();
    tracker.close();
    tracker.wait().await;
}
