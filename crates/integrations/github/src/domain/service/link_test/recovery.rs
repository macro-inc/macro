use super::*;
use crate::domain::models::GithubLinkStatus;

#[tokio::test]
async fn missing_grant_requires_reauthentication_without_calling_github() {
    let user_id = test_user_id();
    let auth = StubAuth::new("unused");
    auth.state.lock().unwrap().missing_access_token = true;
    let oauth = StubGithubOauth::new(false);
    let service = service(
        StubGithubRepo::linked(test_link(&user_id)),
        oauth.clone(),
        auth,
    );

    assert!(matches!(
        service.get_user_link_status(&user_id).await.unwrap(),
        GithubLinkStatus::ReauthenticationRequired
    ));
    assert!(oauth.validated_tokens().is_empty());
}

#[tokio::test]
async fn reconnect_repairs_existing_user_and_shared_owner_after_oauth() {
    let user_id = test_user_id();
    let existing = test_link(&user_id);
    let old_owner = existing.fusionauth_user_id;
    let current_identity = uuid::Uuid::from_u128(42);
    let repo = StubGithubRepo::linked(existing.clone()).with_account_owner(owner_link(old_owner));
    let auth = StubAuth::new("cached-token-from-deleted-identity");
    auth.state.lock().unwrap().missing_identity = Some(old_owner);
    let service = service(repo.clone(), StubGithubOauth::new(false), auth.clone());

    let link = service
        .link_user(
            &user_id,
            &current_identity,
            &uuid::Uuid::nil(),
            "https://redirect.example",
            "code",
        )
        .await
        .unwrap();

    assert_eq!(link.id, existing.id);
    assert_eq!(link.fusionauth_user_id, current_identity);
    assert_eq!(
        repo.state
            .lock()
            .unwrap()
            .link_by_github_user_id
            .as_ref()
            .unwrap()
            .fusionauth_user_id,
        current_identity
    );
    assert_eq!(
        auth.state.lock().unwrap().linked_identities,
        vec![old_owner, current_identity]
    );
    assert!(repo.inserted_links().is_empty());
    assert_eq!(repo.delete_github_link_calls(), 0);
    assert_eq!(repo.delete_in_progress_user_link_calls(), 1);
}

#[tokio::test]
async fn new_sharer_repairs_missing_owner_before_inserting() {
    let user_id = test_user_id();
    let old_owner = uuid::Uuid::from_u128(41);
    let current_identity = uuid::Uuid::from_u128(42);
    let repo = StubGithubRepo::unlinked().with_account_owner(owner_link(old_owner));
    let auth = StubAuth::new("unused");
    auth.state.lock().unwrap().missing_identity = Some(old_owner);
    let service = service(repo.clone(), StubGithubOauth::new(false), auth);

    let link = service
        .link_user(
            &user_id,
            &current_identity,
            &uuid::Uuid::nil(),
            "https://redirect.example",
            "code",
        )
        .await
        .unwrap();

    assert_eq!(link.fusionauth_user_id, current_identity);
    assert_eq!(
        repo.inserted_links()[0].fusionauth_user_id,
        current_identity
    );
    assert_eq!(
        repo.state
            .lock()
            .unwrap()
            .link_by_github_user_id
            .as_ref()
            .unwrap()
            .fusionauth_user_id,
        current_identity
    );
}

#[tokio::test]
async fn failed_repair_preserves_links_and_pending_oauth() {
    let user_id = test_user_id();
    let existing = test_link(&user_id);
    let repo = StubGithubRepo::linked(existing.clone()).with_account_owner(existing.clone());
    let auth = StubAuth::new("unused");
    {
        let mut state = auth.state.lock().unwrap();
        state.missing_identity = Some(existing.fusionauth_user_id);
        state.link_error = Some("FusionAuth unavailable".into());
    }
    let service = service(repo.clone(), StubGithubOauth::new(false), auth);

    let result = service
        .link_user(
            &user_id,
            &uuid::Uuid::from_u128(42),
            &uuid::Uuid::nil(),
            "https://redirect.example",
            "code",
        )
        .await;

    assert!(matches!(result, Err(GithubError::Internal(_))));
    assert_eq!(
        repo.state
            .lock()
            .unwrap()
            .link_by_user_id
            .as_ref()
            .unwrap()
            .fusionauth_user_id,
        existing.fusionauth_user_id
    );
    assert!(repo.inserted_links().is_empty());
    assert_eq!(repo.delete_github_link_calls(), 0);
    assert_eq!(repo.delete_in_progress_user_link_calls(), 0);
}

#[tokio::test]
async fn reconnect_with_different_account_preserves_existing_connection() {
    let user_id = test_user_id();
    let mut existing = test_link(&user_id);
    existing.github_user_id = "different-account".into();
    let repo = StubGithubRepo::linked(existing.clone());
    let auth = StubAuth::new("valid-token");
    let service = service(repo.clone(), StubGithubOauth::new(false), auth.clone());

    let result = service
        .link_user(
            &user_id,
            &uuid::Uuid::from_u128(42),
            &uuid::Uuid::nil(),
            "https://redirect.example",
            "code",
        )
        .await;

    assert!(matches!(result, Err(GithubError::AccountMismatch)));
    assert_eq!(auth.link_user_calls(), 0);
    assert_eq!(auth.delete_user_link_calls(), 0);
    assert_eq!(repo.delete_github_link_calls(), 0);
    assert!(repo.inserted_links().is_empty());
}

#[tokio::test]
async fn reconnect_serializes_another_refresh_and_disconnect_until_grant_is_stored() {
    for disconnect in [false, true] {
        let user_id = test_user_id();
        let existing = test_link(&user_id);
        let repo = StubGithubRepo::linked(existing.clone()).with_account_owner(existing.clone());
        let auth = StubAuth::new("valid-token");
        let started = Arc::new(tokio::sync::Notify::new());
        let finish = Arc::new(tokio::sync::Notify::new());
        auth.state.lock().unwrap().link_barrier = Some((started.clone(), finish.clone()));
        let service = Arc::new(service(
            repo.clone(),
            StubGithubOauth::new(false),
            auth.clone(),
        ));
        let first = tokio::spawn({
            let service = service.clone();
            let user_id = user_id.clone();
            async move {
                service
                    .link_user(
                        &user_id,
                        &uuid::Uuid::nil(),
                        &uuid::Uuid::nil(),
                        "https://redirect.example",
                        "code",
                    )
                    .await
            }
        });
        started.notified().await;
        let other_user = MacroUserIdStr::try_from_email("sharer@example.com")
            .unwrap()
            .0;
        let mut second = Box::pin(async {
            if disconnect {
                service.delete_user_link(&other_user).await
            } else {
                service
                    .link_user(
                        &other_user,
                        &uuid::Uuid::nil(),
                        &uuid::Uuid::nil(),
                        "https://redirect.example",
                        "code",
                    )
                    .await
                    .map(|_| ())
            }
        });
        // Poll the competing operation while the first grant write is blocked.
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(second.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        assert_eq!(auth.link_user_calls(), 0);
        assert_eq!(auth.delete_user_link_calls(), 0);
        assert_eq!(repo.delete_in_progress_user_link_calls(), 0);

        finish.notify_one();
        first.await.unwrap().unwrap();
        second.await.unwrap();
        assert_eq!(auth.link_user_calls(), if disconnect { 1 } else { 2 });
        assert_eq!(auth.delete_user_link_calls(), u32::from(disconnect));
    }
}
