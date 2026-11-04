use super::*;

#[tokio::test]
async fn cancellation_drops_the_inflight_job_and_drains_tracker() {
    let tracker = TaskTracker::new();
    let stop = CancellationToken::new();
    let entered = Arc::new(tokio::sync::Notify::new());
    let action_entered = entered.clone();
    spawn(
        "test",
        Schedule::from_cron("0 0 0 * * *".into()).unwrap(),
        &tracker,
        stop.clone(),
        move || {
            let entered = action_entered.clone();
            async move {
                entered.notify_one();
                std::future::pending::<anyhow::Result<()>>().await
            }
        },
    );
    entered.notified().await;
    stop.cancel();
    tracker.close();
    tracker.wait().await;
    assert!(tracker.is_empty());
}
