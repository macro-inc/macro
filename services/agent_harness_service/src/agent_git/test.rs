use super::*;

#[test]
fn missing_git_fails_startup() {
    let error =
        check_git(Path::new("/does-not-exist/agent-git-runtime/git")).expect_err("git is missing");
    assert!(error.to_string().contains("need git"), "{error}");
}

#[test]
fn installed_git_includes_the_smart_http_backend() {
    check_git(Path::new("git")).expect("git and git-http-backend are installed");
}

#[tokio::test(start_paused = true)]
async fn unfinished_git_tasks_cannot_hold_shutdown_past_the_deadline() {
    let tasks = TaskTracker::new();
    let (finish, finished) = tokio::sync::oneshot::channel::<()>();
    tasks.spawn(async move {
        let _ = finished.await;
    });

    assert!(drain(&tasks).await.is_err());
    finish.send(()).unwrap();
    tasks.wait().await;
}
