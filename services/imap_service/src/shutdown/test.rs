use super::*;

#[tokio::test(start_paused = true)]
async fn the_http_and_tracked_work_drain_share_one_shutdown_budget() {
    let tasks = TaskTracker::new();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    tasks.spawn(async move {
        started.send(()).unwrap();
        let _ = released.await;
    });
    ready.await.unwrap();
    tasks.close();
    let before = tokio::time::Instant::now();
    // Half the grace is spent finishing HTTP, then the task remains pending.
    let result = drain(
        async {
            tokio::time::timeout(Duration::from_secs(15), std::future::pending::<()>())
                .await
                .unwrap_err();
            Ok(())
        },
        &tasks,
    )
    .await;
    assert!(result.is_err());
    assert_eq!(before.elapsed(), Duration::from_secs(30));
    release.send(()).unwrap();
    tasks.wait().await;
}

#[tokio::test(start_paused = true)]
async fn an_http_server_failure_still_drains_tracked_work() {
    let tasks = TaskTracker::new();
    let (started, ready) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    tasks.spawn(async move {
        started.send(()).unwrap();
        let _ = released.await;
    });
    tasks.close();
    let draining = drain(
        async { Err(std::io::Error::other("synthetic server failure")) },
        &tasks,
    );
    tokio::pin!(draining);
    tokio::select! {
        biased;
        result = &mut draining => panic!("tracked work was not drained: {result:?}"),
        result = ready => result.unwrap(),
    }
    release.send(()).unwrap();
    assert!(draining.await.is_err());
}
