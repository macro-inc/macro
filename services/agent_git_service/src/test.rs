use super::*;

#[tokio::test(start_paused = true)]
async fn unfinished_git_tasks_cannot_hold_shutdown_past_the_deadline() {
    let tasks = TaskTracker::new();
    let (finish, finished) = tokio::sync::oneshot::channel::<()>();
    tasks.spawn(async move {
        let _ = finished.await;
    });

    assert!(drain_git_tasks(&tasks).await.is_err());
    finish.send(()).unwrap();
    tasks.wait().await;
}
