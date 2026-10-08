use super::*;
use crate::domain::service::test::{TestService, stored_owner, with_stopped_dispatcher};

const INTERNAL_KEY: &str = "test-internal-key";

/// A routine its owner created, then handed to the team.
async fn team_action(service: &Arc<TestService>) -> Uuid {
    let app = router_with(Arc::clone(service), FakeEntityAccessService::owner_only());
    let (_, created) = request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
    let id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    set_stored_owner(service, id, Owner::Team(TEAM_ID));
    id
}

async fn purge(app: &Router, uri: &str, headers: &[(&str, &str)]) -> StatusCode {
    let mut request = Request::builder().method("DELETE").uri(uri);
    for (key, value) in headers {
        request = request.header(*key, *value);
    }
    app.clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

async fn purge_internally(app: &Router, uri: &str) -> StatusCode {
    purge(
        app,
        uri,
        &[(macro_authorization::INTERNAL_API_KEY_HEADER, INTERNAL_KEY)],
    )
    .await
}

#[tokio::test]
async fn purges_only_for_the_owner_it_names() {
    let service = service(true);
    let id = team_action(&service).await;
    let app = router_with(Arc::clone(&service), FakeEntityAccessService::owner_only());
    let other_team = Uuid::from_u128(0x7EA5);
    let bot = Owner::Bot(bot_id::BotId::TEST_A)
        .principal_id()
        .replace('|', "%7C");

    for owner in [other_team.to_string(), bot] {
        let uri = format!("/scheduled-actions/internal/{id}?owner={owner}");
        assert_eq!(purge_internally(&app, &uri).await, StatusCode::CONFLICT);
    }
    assert_eq!(stored_owner(&service, id), Some(Owner::Team(TEAM_ID)));

    let uri = format!("/scheduled-actions/internal/{id}?owner={TEAM_ID}");
    assert_eq!(purge_internally(&app, &uri).await, StatusCode::NO_CONTENT);
    assert_eq!(stored_owner(&service, id), None);
    assert_eq!(
        purge_internally(&app, &uri).await,
        StatusCode::NO_CONTENT,
        "a retry finds nothing left"
    );
}

#[tokio::test]
async fn a_failed_purge_is_a_server_error_and_keeps_the_action() {
    let service = service(true);
    let id = team_action(&service).await;
    let app = router_with(
        with_stopped_dispatcher(&service),
        FakeEntityAccessService::owner_only(),
    );

    let uri = format!("/scheduled-actions/internal/{id}?owner={TEAM_ID}");

    assert_eq!(
        purge_internally(&app, &uri).await,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(stored_owner(&service, id), Some(Owner::Team(TEAM_ID)));
}

#[tokio::test]
async fn only_the_internal_key_may_purge() {
    let service = service(true);
    let id = team_action(&service).await;
    let app = router_with(Arc::clone(&service), FakeEntityAccessService::owner_only());
    let uri = format!("/scheduled-actions/internal/{id}?owner={TEAM_ID}");

    for headers in [
        vec![],
        vec![("authorization", "Bearer owner")],
        vec![(BOT_TOKEN_HEADER, BOT_TOKEN), (BOT_SCOPE_HEADER, "team")],
        vec![(macro_authorization::INTERNAL_API_KEY_HEADER, "bad-key")],
    ] {
        let status = purge(&app, &uri, &headers).await;
        assert!(status.is_client_error(), "{headers:?} answered {status}");
    }
    assert_eq!(stored_owner(&service, id), Some(Owner::Team(TEAM_ID)));
}

#[tokio::test]
async fn a_malformed_purge_is_a_bad_request() {
    let service = service(true);
    let id = team_action(&service).await;
    let app = router_with(Arc::clone(&service), FakeEntityAccessService::owner_only());

    for uri in [
        format!("/scheduled-actions/internal/not-an-id?owner={TEAM_ID}"),
        format!("/scheduled-actions/internal/{id}"),
        format!("/scheduled-actions/internal/{id}?owner=not-an-owner"),
    ] {
        assert_eq!(
            purge_internally(&app, &uri).await,
            StatusCode::BAD_REQUEST,
            "{uri}"
        );
    }
    assert_eq!(stored_owner(&service, id), Some(Owner::Team(TEAM_ID)));
}
