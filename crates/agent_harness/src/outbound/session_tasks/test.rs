use super::*;

fn pull_request(status: Option<&str>, name: Option<&str>) -> GithubPullRequest {
    let mut pull_request = GithubPullRequest::from_github_key("org/repo/pull/7").unwrap();
    pull_request.status = status.map(str::to_owned);
    pull_request.name = name.map(str::to_owned);
    pull_request
}

#[test]
fn maps_indexed_and_unindexed_pull_requests() {
    assert_eq!(
        task_pull_request(pull_request(Some("merged"), Some("Fix the thing"))),
        TaskPullRequest {
            url: "https://github.com/org/repo/pull/7".to_owned(),
            title: Some("Fix the thing".to_owned()),
            state: Some(PullRequestState::Merged),
        }
    );
    for (status, state) in [
        ("open", PullRequestState::Open),
        ("closed", PullRequestState::Closed),
    ] {
        assert_eq!(
            task_pull_request(pull_request(Some(status), None)).state,
            Some(state)
        );
    }
    assert_eq!(
        task_pull_request(pull_request(None, None)),
        TaskPullRequest {
            url: "https://github.com/org/repo/pull/7".to_owned(),
            title: None,
            state: None,
        }
    );
}

#[test]
fn hidden_and_missing_tasks_look_alike_and_other_documents_are_not_tasks() {
    assert!(matches!(
        access_error(AccessError::Unauthorized),
        SessionTaskError::TaskNotFound
    ));
    assert!(matches!(
        access_error(AccessError::NotFound("document")),
        SessionTaskError::TaskNotFound
    ));
    assert!(matches!(
        document_error(DocumentError::NotFound("task".to_owned())),
        SessionTaskError::TaskNotFound
    ));
    assert!(matches!(
        document_error(DocumentError::BadRequest(
            "document is not a task".to_owned()
        )),
        SessionTaskError::NotATask
    ));
    assert!(matches!(
        document_error(DocumentError::Internal(anyhow::anyhow!("database down"))),
        SessionTaskError::Unavailable(_)
    ));
}
