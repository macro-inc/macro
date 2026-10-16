use super::*;
use crate::domain::ports::MockGithubSyncRepo;

#[tokio::test]
async fn links_one_task_to_the_pull_request() {
    let task = MacroTaskId::from_short_uuid("2BuyvtY3ae").unwrap();
    let mut repo = MockGithubSyncRepo::new();
    let expected = task.clone();
    repo.expect_upsert_task_ids()
        .withf(move |key, tasks| {
            key.as_ref() == "macro-inc/macro/pull/7" && tasks == std::slice::from_ref(&expected)
        })
        .times(1)
        .returning(|_, _| Box::pin(std::future::ready(Ok(()))));
    PullRequestTaskLinkService::new(repo)
        .link(GithubKey::new("macro-inc", "macro", 7), task)
        .await
        .unwrap();
}

#[tokio::test]
async fn reports_a_failed_write() {
    let mut repo = MockGithubSyncRepo::new();
    repo.expect_upsert_task_ids().returning(|_, _| {
        Box::pin(std::future::ready(Err(anyhow::anyhow!(
            "database unavailable"
        ))))
    });
    let result = PullRequestTaskLinkService::new(repo)
        .link(
            GithubKey::new("macro-inc", "macro", 7),
            MacroTaskId::from_short_uuid("2BuyvtY3ae").unwrap(),
        )
        .await;
    assert!(matches!(result, Err(GithubError::Internal(_))));
}
