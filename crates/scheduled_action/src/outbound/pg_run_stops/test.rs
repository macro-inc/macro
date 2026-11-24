use std::sync::Arc;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::generate_uuid_v7;

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stop_sent_through_postgres_reaches_the_instance_listening(pool: PgPool) {
    let tracker = TaskTracker::new();
    let shutdown = CancellationToken::new();
    // The instance running the run hears stops; another one sends it.
    let running = RunStops::default();
    listen_for_stops(pool.clone(), running.clone(), &tracker, shutdown.clone()).await;
    let sending = RunStops::new(Some(Arc::new(PgStopRelay::new(pool.clone()))));

    let run = generate_uuid_v7();
    let watch = running.watch();
    sqlx::query!("SELECT pg_notify($1, $2)", RUN_STOP_CHANNEL, "not a stop")
        .execute(&pool)
        .await
        .unwrap();
    sending.request(run).await.unwrap();
    watch.stopped(run).await;

    shutdown.cancel();
    tracker.close();
    tracker.wait().await;
}

#[test]
fn a_notice_without_a_trace_reads_back() {
    let run = generate_uuid_v7();
    let notice: StopNotice = serde_json::from_str(&format!(r#"{{"run":"{run}"}}"#)).unwrap();
    assert_eq!(
        notice,
        StopNotice {
            run,
            traceparent: None
        }
    );
}
