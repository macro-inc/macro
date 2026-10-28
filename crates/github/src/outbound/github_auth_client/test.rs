use super::*;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, method, path},
};

fn client(server: &MockServer) -> FusionAuthClient {
    FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        server.uri(),
        "http://localhost/callback".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    )
}

fn grant(account: &str, token: &str) -> serde_json::Value {
    json!({
        "displayName": "octocat", "identityProviderId": "github",
        "identityProviderName": "GitHub", "identityProviderType": "GitHub",
        "identityProviderUserId": account, "insertInstant": 0,
        "lastLoginInstant": 0, "tenantId": "tenant", "token": token,
        "userId": uuid::Uuid::nil().to_string()
    })
}

#[tokio::test]
async fn refresh_replaces_the_matching_grant_and_restores_it_on_failure() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/identity-provider/link"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "identityProviderLinks": [grant("other", "other-token"), grant("1", "old-token")]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(wiremock::matchers::query_param(
            "identityProviderUserId",
            "1",
        ))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(body_partial_json(json!({ "identityProviderLink": { "identityProviderUserId": "1", "token": "new-token" } })))
        .respond_with(ResponseTemplate::new(500)).expect(1).mount(&server).await;
    Mock::given(method("POST"))
        .and(body_partial_json(json!({ "identityProviderLink": { "identityProviderUserId": "1", "token": "old-token" } })))
        .respond_with(ResponseTemplate::new(200)).expect(1).mount(&server).await;

    let result = refresh_grant(
        &client(&server),
        &uuid::Uuid::nil(),
        "github",
        "1",
        "octocat",
        "new-token",
    )
    .await;

    assert!(result.is_err());
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests
            .iter()
            .map(|request| request.method.as_str())
            .collect::<Vec<_>>(),
        ["GET", "DELETE", "POST", "POST"]
    );
}

#[tokio::test]
async fn refresh_stores_fresh_token_and_identical_token_is_idempotent() {
    for old_token in ["old-token", "new-token"] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "identityProviderLinks": [grant("1", old_token)] })),
            )
            .expect(1)
            .mount(&server)
            .await;
        let writes = u64::from(old_token != "new-token");
        Mock::given(method("DELETE"))
            .respond_with(ResponseTemplate::new(200))
            .expect(writes)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(body_partial_json(
                json!({ "identityProviderLink": { "token": "new-token" } }),
            ))
            .respond_with(ResponseTemplate::new(200))
            .expect(writes)
            .mount(&server)
            .await;

        assert_eq!(
            refresh_grant(
                &client(&server),
                &uuid::Uuid::nil(),
                "github",
                "1",
                "octocat",
                "new-token"
            )
            .await
            .unwrap(),
            GithubGrantLinkOutcome::Linked
        );
    }
}

#[tokio::test]
async fn reconnect_recreates_a_grant_after_replacement_and_restoration_fail() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "identityProviderLinks": [grant("1", "old-token")]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    // Both the replacement and its best-effort restoration fail.
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(503))
        .expect(2)
        .mount(&server)
        .await;
    let client = client(&server);
    assert!(
        refresh_grant(
            &client,
            &uuid::Uuid::nil(),
            "github",
            "1",
            "octocat",
            "new-token"
        )
        .await
        .is_err()
    );
    server.verify().await;
    server.reset().await;

    // A crash after unlink leaves the same persistent state: an absent grant.
    // A subsequent verified OAuth attempt must recreate it without an unlink.
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(body_partial_json(json!({
            "identityProviderLink": { "identityProviderUserId": "1", "token": "retry-token" }
        })))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        refresh_grant(
            &client,
            &uuid::Uuid::nil(),
            "github",
            "1",
            "octocat",
            "retry-token"
        )
        .await
        .unwrap(),
        GithubGrantLinkOutcome::Linked
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        requests
            .iter()
            .map(|request| request.method.as_str())
            .collect::<Vec<_>>(),
        ["GET", "POST"]
    );
}

#[tokio::test]
async fn deleted_identity_is_reported_without_writes() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(
            ResponseTemplate::new(400).set_body_json(
                json!({ "fieldErrors": { "userId": [{ "code": "[invalid]userId" }] } }),
            ),
        )
        .expect(1)
        .mount(&server)
        .await;

    assert_eq!(
        refresh_grant(
            &client(&server),
            &uuid::Uuid::nil(),
            "github",
            "1",
            "octocat",
            "new-token"
        )
        .await
        .unwrap(),
        GithubGrantLinkOutcome::IdentityMissing
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn delayed_lookup_cannot_overwrite_reconnected_token() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tokio::sync::Notify;

    let url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let mut conn = redis::Client::open(url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .expect("GitHub integration tests require local Redis or REDIS_URL; see docs/development/database.md");
    let identity = macro_uuid::generate_uuid_v7();
    // Legacy identity-only entries must not be used for another account.
    let legacy_key = format!("github_access_token_key:{identity}");
    conn.set_ex::<_, _, ()>(&legacy_key, "wrong-account-token", 60)
        .await
        .unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = axum::Router::new().route("/api/identity-provider/link", axum::routing::get({
        let requests = requests.clone();
        let started = started.clone();
        let release = release.clone();
        move || {
            let requests = requests.clone();
            let started = started.clone();
            let release = release.clone();
            async move {
                let snapshot = json!({ "identityProviderLinks": [grant("other", "other-token"), grant("1", "old-token")] });
                if requests.fetch_add(1, Ordering::SeqCst) == 0 {
                    started.notify_one();
                    release.notified().await;
                }
                axum::Json(snapshot)
            }
        }
    }).delete(|| async { axum::http::StatusCode::OK }).post(|| async { axum::http::StatusCode::OK }));
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let fusionauth = FusionAuthClient::new(
        "api-key".into(),
        "application-id".into(),
        "client-secret".into(),
        format!("http://{address}"),
        "http://localhost/callback".into(),
        "google-client-id".into(),
        "google-client-secret".into(),
    );
    let adapter = GithubAuthImpl::new(fusionauth, conn.clone());
    let lookup = tokio::spawn({
        let adapter = adapter.clone();
        async move {
            adapter
                .retreive_access_token(&identity, "github", "1")
                .await
                .unwrap()
                .unwrap()
        }
    });
    started.notified().await;
    assert_eq!(
        adapter
            .link_user(&identity, "github", "1", "octocat", "new-token")
            .await
            .unwrap(),
        GithubGrantLinkOutcome::Linked
    );
    release.notify_one();

    assert_eq!(lookup.await.unwrap().as_str(), "new-token");
    assert_eq!(
        adapter
            .retreive_access_token(&identity, "github", "1")
            .await
            .unwrap()
            .unwrap()
            .as_str(),
        "new-token"
    );
    assert_eq!(requests.load(Ordering::SeqCst), 2);
    conn.del::<_, ()>(&[legacy_key, github_access_token_key!(identity, "1")])
        .await
        .unwrap();
    server.abort();
}
