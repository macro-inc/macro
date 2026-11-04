use super::*;
use crate::domain::models::SetGithubPullRequestStateRequest;

fn state_request(state: GithubPullRequestState) -> SetGithubPullRequestStateRequest {
    SetGithubPullRequestStateRequest {
        owner: "macro".to_string(),
        repo: "app".to_string(),
        number: 7,
        state,
    }
}

#[tokio::test]
async fn set_pull_request_state_closes_and_refreshes() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false).with_state_outcome(GithubStateOutcome::Changed {
        state: GithubPullRequestState::Closed,
    });
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let response = service
        .set_pull_request_state(&user_id, state_request(GithubPullRequestState::Closed))
        .await
        .unwrap();

    assert_eq!(response.state, GithubPullRequestState::Closed);
    assert_eq!(
        response
            .pull_request
            .map(|pull_request| pull_request.github_key),
        Some("macro/app/pull/7".to_string())
    );
    assert_eq!(
        oauth.state_calls(),
        vec![("macro/app".to_string(), 7, GithubPullRequestState::Closed)]
    );
    assert_eq!(oauth.pull_request_detail_calls().len(), 1);
}

#[tokio::test]
async fn set_pull_request_state_surfaces_githubs_refusal() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false).with_state_outcome(GithubStateOutcome::Rejected {
        rejection: GithubPullRequestUpdateRejection::Invalid,
        message: "state cannot be changed. The head branch was deleted.".to_string(),
    });
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let result = service
        .set_pull_request_state(&user_id, state_request(GithubPullRequestState::Open))
        .await;

    match result {
        Err(GithubError::PullRequestUpdateRejected { rejection, message }) => {
            assert_eq!(rejection, GithubPullRequestUpdateRejection::Invalid);
            assert_eq!(
                message,
                "state cannot be changed. The head branch was deleted."
            );
        }
        other => panic!("expected an update rejection, got {other:?}"),
    }
    assert!(oauth.pull_request_detail_calls().is_empty());
}

#[tokio::test]
async fn set_pull_request_state_requires_a_valid_grant() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(true);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("expired-token"),
    );

    let result = service
        .set_pull_request_state(&user_id, state_request(GithubPullRequestState::Closed))
        .await;

    assert!(matches!(result, Err(GithubError::ReauthenticationRequired)));
    assert!(oauth.state_calls().is_empty());
}
