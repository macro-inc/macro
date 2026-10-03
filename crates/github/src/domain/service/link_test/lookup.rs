use super::*;

#[tokio::test]
async fn get_user_link_returns_no_link_found_without_db_link() {
    let user_id = test_user_id();
    let service = service(
        StubGithubRepo::unlinked(),
        StubGithubOauth::new(false),
        StubAuth::new("valid-token"),
    );

    assert!(matches!(
        service.get_user_link(&user_id).await,
        Err(GithubError::NoLinkFound)
    ));
}

#[tokio::test]
async fn get_user_link_returns_no_link_found_after_concurrent_unlink() {
    let user_id = test_user_id();
    let repo = StubGithubRepo::linked(test_link(&user_id));
    let service = service(
        repo.clone(),
        StubGithubOauth::new(false),
        StubAuth::new("valid-token"),
    );
    service.check_user_link_token(&user_id).await.unwrap();
    repo.state.lock().unwrap().link_by_user_id = None;

    assert!(matches!(
        service.get_user_link(&user_id).await,
        Err(GithubError::NoLinkFound)
    ));
}

#[tokio::test]
async fn get_user_link_preserves_link_identity() {
    let user_id = test_user_id();
    let expected = test_link(&user_id);
    let service = service(
        StubGithubRepo::linked(expected.clone()),
        StubGithubOauth::new(false),
        StubAuth::new("valid-token"),
    );

    let actual = service.get_user_link(&user_id).await.unwrap();
    assert_eq!(actual.github_user_id, expected.github_user_id);
    assert_eq!(actual.github_username, expected.github_username);
}
