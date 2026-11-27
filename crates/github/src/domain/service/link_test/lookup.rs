use super::*;
use crate::domain::models::GithubLinkStatus;

#[tokio::test]
async fn get_user_link_status_is_not_linked_without_db_link() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::unlinked(),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let status = service.get_user_link_status(&user_id).await.unwrap();

    assert!(matches!(status, GithubLinkStatus::NotLinked));
    assert!(oauth.validated_tokens().is_empty());
}

#[tokio::test]
async fn get_user_link_status_is_linked_with_valid_token() {
    let user_id = test_user_id();
    let expected = test_link(&user_id);
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::linked(expected.clone()),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    let status = service.get_user_link_status(&user_id).await.unwrap();

    let GithubLinkStatus::Linked(actual) = status else {
        panic!("expected a linked status, got {status:?}");
    };
    assert_eq!(actual.github_user_id, expected.github_user_id);
    assert_eq!(actual.github_username, expected.github_username);
    assert_eq!(oauth.validated_tokens(), vec!["valid-token".to_string()]);
}

#[tokio::test]
async fn get_user_link_status_requires_reauthentication_for_expired_token() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(true);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("expired-token"),
    );

    let status = service.get_user_link_status(&user_id).await.unwrap();

    assert!(matches!(status, GithubLinkStatus::ReauthenticationRequired));
    assert_eq!(oauth.validated_tokens(), vec!["expired-token".to_string()]);
}

#[tokio::test]
async fn get_user_link_status_surfaces_token_lookup_failures() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("valid-token").fail_access_token("an unknown error occurred"),
    );

    let result = service.get_user_link_status(&user_id).await;

    assert!(matches!(result, Err(GithubError::Internal(_))));
    assert!(oauth.validated_tokens().is_empty());
}

#[tokio::test]
async fn get_user_link_status_surfaces_sign_in_service_outages() {
    let user_id = test_user_id();
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        StubGithubOauth::new(false),
        StubAuth::new("valid-token").fail_access_token_upstream(UpstreamFailure::Unavailable),
    );

    let result = service.get_user_link_status(&user_id).await;

    assert!(matches!(
        result,
        Err(GithubError::Upstream(UpstreamError {
            failure: UpstreamFailure::Unavailable,
            ..
        }))
    ));
}

#[tokio::test]
async fn get_user_link_status_surfaces_github_rate_limits() {
    let user_id = test_user_id();
    let rate_limited = UpstreamFailure::RateLimited {
        retry_after: Some(std::time::Duration::from_secs(60)),
    };
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        StubGithubOauth::new(false).fail_token_check(rate_limited),
        StubAuth::new("valid-token"),
    );

    let result = service.get_user_link_status(&user_id).await;

    assert!(matches!(
        result,
        Err(GithubError::Upstream(UpstreamError { failure, .. })) if failure == rate_limited
    ));
}

#[tokio::test]
async fn get_user_access_token_checks_a_token_with_github_once_per_window() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("valid-token"),
    );

    for _ in 0..3 {
        let token = service.get_user_access_token(&user_id).await.unwrap();
        assert_eq!(token.as_str(), "valid-token");
    }

    assert_eq!(oauth.validated_tokens(), vec!["valid-token".to_string()]);
}

#[tokio::test]
async fn get_user_access_token_checks_a_token_again_once_the_window_passes() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("valid-token"),
    )
    .with_token_validation_window(std::time::Duration::ZERO);

    service.get_user_access_token(&user_id).await.unwrap();
    service.get_user_access_token(&user_id).await.unwrap();

    assert_eq!(
        oauth.validated_tokens(),
        vec!["valid-token".to_string(), "valid-token".to_string()]
    );
}

#[tokio::test]
async fn get_user_access_token_never_remembers_a_token_github_rejected() {
    let user_id = test_user_id();
    let oauth = StubGithubOauth::new(true);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        StubAuth::new("expired-token"),
    );

    for _ in 0..2 {
        let result = service.get_user_access_token(&user_id).await;
        assert!(matches!(result, Err(GithubError::ReauthenticationRequired)));
    }

    assert_eq!(
        oauth.validated_tokens(),
        vec!["expired-token".to_string(), "expired-token".to_string()]
    );
}
