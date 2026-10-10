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
