use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::NaiveDate;
use connect_registry::{Access, App, AppId, ClientRegistration, Status};
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use tower::ServiceExt as _;
use url::Url;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_string_contains, header as header_matcher, method, path},
};

use crate::{
    AppState,
    domain::{
        GrantCipher, Repository as _, Service,
        oauth::{Client, OAuthService},
    },
    outbound::{EnvelopeCipher, LocalKeyWrapper, PostgresRepository, oauth::VendorOAuth},
    router,
    test_support::TestDatabase,
};

#[test]
fn redirect_origins_accept_only_https_or_local_http_without_paths() {
    use crate::domain::oauth::validate_origin;
    for origin in [
        "https://customer.example",
        "https://customer.example:8443",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ] {
        assert!(validate_origin(origin).is_ok(), "{origin}");
    }
    for origin in [
        "http://customer.example",
        "https://customer.example/path",
        "https://customer.example/",
        "https://customer.example?x=1",
        "https://user@customer.example",
        "ftp://customer.example",
    ] {
        assert!(validate_origin(origin).is_err(), "{origin}");
    }
}

pub(crate) async fn vendor_server(
    kind: ClientRegistration,
    access_expires_in: i64,
    refresh_error: bool,
    refresh_expected: u64,
) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/mcp"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(path("/.well-known/oauth-authorization-server/mcp"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issuer": server.uri(),
            "authorization_endpoint": format!("{}/authorize", server.uri()),
            "token_endpoint": format!("{}/token", server.uri()),
            "registration_endpoint": if kind == ClientRegistration::Dcr { Some(format!("{}/register", server.uri())) } else { None },
            "client_id_metadata_document_supported": kind == ClientRegistration::Cimd,
            "response_types_supported": ["code"],
            "code_challenge_methods_supported": ["S256"]
        }))).mount(&server).await;
    if kind == ClientRegistration::Dcr {
        Mock::given(method("POST"))
            .and(path("/register"))
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({
                "client_id": "dynamic-client", "client_secret": "dynamic-secret",
                "redirect_uris": ["https://connect.example/v1/oauth/callback"]
            })))
            .expect(1)
            .mount(&server)
            .await;
    }
    Mock::given(method("POST"))
        .and(path("/token"))
        .and(body_string_contains("grant_type=authorization_code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "first-token", "refresh_token": "refresh-secret",
            "token_type": "Bearer", "expires_in": access_expires_in, "scope": "read"
        })))
        .mount(&server)
        .await;
    if refresh_error {
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .respond_with(
                ResponseTemplate::new(400).set_body_json(json!({"error": "invalid_grant"})),
            )
            .expect(1)
            .mount(&server)
            .await;
    } else {
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "access_token": "refreshed-token", "refresh_token": "next-refresh",
                "token_type": "Bearer", "expires_in": 3600, "scope": "read"
            })))
            .expect(refresh_expected)
            .mount(&server)
            .await;
    }
    server
}

pub(crate) fn fixture(
    pool: sqlx::PgPool,
    server: &MockServer,
    kind: ClientRegistration,
    public_url: &str,
) -> (axum::Router, Arc<PostgresRepository>, &'static [App]) {
    let app = App {
        id: AppId::parse("testapp").unwrap(),
        name: "Test".into(),
        description: "Test MCP".into(),
        access: vec![Access::Mcp],
        mcp_url: format!("{}/mcp", server.uri()),
        client_registration: kind,
        scopes: vec!["read".into()],
        pipedream_app_slugs: vec![],
        status: Status::Live,
        probed: NaiveDate::from_ymd_opt(2026, 10, 30).unwrap(),
        icon_svg: None,
    };
    let apps: &'static [App] = Box::leak(vec![app].into_boxed_slice());
    let repository = Arc::new(PostgresRepository::new(pool));
    let cipher: Arc<dyn GrantCipher> = Arc::new(EnvelopeCipher::new(Arc::new(
        LocalKeyWrapper::from_base64(&STANDARD.encode([4_u8; 32])).unwrap(),
    )));
    let own_apps = HashMap::from([(
        "testapp".into(),
        Client {
            id: "own-client".into(),
            secret: Some("own-secret".to_owned().into()),
            kind: ClientRegistration::OwnApp,
        },
    )]);
    let oauth = Arc::new(OAuthService::new(
        repository.clone(),
        cipher.clone(),
        Arc::new(VendorOAuth::new().unwrap()),
        apps,
        Url::parse(public_url).unwrap(),
        own_apps,
    ));
    let service = Arc::new(Service::new(repository.clone()));
    (
        router(AppState {
            apps,
            service,
            oauth,
            mcp_http: crate::outbound::mcp::VendorMcp::new().unwrap(),
        }),
        repository,
        apps,
    )
}

#[tokio::test]
async fn gateway_prefix_is_preserved_in_oauth_urls() {
    let vendor = vendor_server(ClientRegistration::Cimd, 3600, false, 0).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/connect_test")
        .unwrap();
    let (app, _, _) = fixture(
        pool,
        &vendor,
        ClientRegistration::Cimd,
        "https://connect.example/connect",
    );
    let response = app
        .oneshot(
            Request::builder()
                .uri("/connect/v1/oauth/client-metadata.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(
        body["client_id"],
        "https://connect.example/connect/v1/oauth/client-metadata.json"
    );
    assert_eq!(
        body["redirect_uris"][0],
        "https://connect.example/connect/v1/oauth/callback"
    );
}

pub(crate) async fn start(app: &axum::Router, key: &str, redirect_url: &str) -> (String, String) {
    let response = app.clone().oneshot(Request::builder().method(Method::POST).uri("/v1/connect-sessions")
        .header(header::AUTHORIZATION, format!("Bearer {key}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"external_user_id":"user-a","app_id":"testapp","redirect_url":redirect_url}).to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let connect_url = body["connect_url"].as_str().unwrap();
    let path = Url::parse(connect_url).unwrap().path().to_owned();
    let response = app
        .clone()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let authorization_url = response.headers()[header::LOCATION]
        .to_str()
        .unwrap()
        .to_owned();
    let state = Url::parse(&authorization_url)
        .unwrap()
        .query_pairs()
        .find(|(key, _)| key == "state")
        .unwrap()
        .1
        .into_owned();
    (authorization_url, state)
}

pub(crate) async fn callback(app: &axum::Router, state: &str, extra: &str) -> String {
    let mut url = Url::parse("http://localhost/v1/oauth/callback").unwrap();
    url.query_pairs_mut()
        .append_pair("state", state)
        .append_pair("code", "ok");
    if !extra.is_empty() {
        url.query_pairs_mut().append_pair("error", extra);
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("{}?{}", url.path(), url.query().unwrap()))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    response.headers()[header::LOCATION]
        .to_str()
        .unwrap()
        .to_owned()
}

async fn export(app: &axum::Router, key: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/users/user-a/connections/testapp/token")
                .header(header::AUTHORIZATION, format!("Bearer {key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    (status, body)
}

#[tokio::test]
#[expect(
    clippy::disallowed_methods,
    reason = "Connect tests use runtime-checked SQLx queries against their own test database"
)]
async fn cimd_flow_state_reuse_expiry_allowlist_and_vendor_error() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    let vendor = vendor_server(ClientRegistration::Cimd, 3600, false, 0).await;
    let (app, repository, _) = fixture(
        pool.clone(),
        &vendor,
        ClientRegistration::Cimd,
        "https://connect.example",
    );
    let metadata = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/oauth/client-metadata.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(metadata.status(), StatusCode::OK);
    let metadata: Value =
        serde_json::from_slice(&metadata.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(
        metadata["client_id"],
        "https://connect.example/v1/oauth/client-metadata.json"
    );
    assert_eq!(
        metadata["redirect_uris"][0],
        "https://connect.example/v1/oauth/callback"
    );
    let key = repository
        .create_customer_with_origins("Macro", &["https://customer.example".into()])
        .await
        .unwrap();
    let denied = app.clone().oneshot(Request::builder().method(Method::POST).uri("/v1/connect-sessions")
        .header(header::AUTHORIZATION, format!("Bearer {}", key.as_str()))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"external_user_id":"user-a","app_id":"testapp","redirect_url":"https://wrong.example/done"}).to_string())).unwrap()).await.unwrap();
    assert_eq!(denied.status(), StatusCode::BAD_REQUEST);
    for redirect_url in [
        "https://customer.example/done?status=connected",
        "https://user@customer.example/done",
    ] {
        let response = app.clone().oneshot(Request::builder().method(Method::POST).uri("/v1/connect-sessions")
            .header(header::AUTHORIZATION, format!("Bearer {}", key.as_str()))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({"external_user_id":"user-a","app_id":"testapp","redirect_url":redirect_url}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let (authorization_url, state) = start(&app, &key, "https://customer.example/done").await;
    assert!(
        authorization_url.contains(
            "client_id=https%3A%2F%2Fconnect.example%2Fv1%2Foauth%2Fclient-metadata.json"
        )
    );
    assert!(
        callback(&app, &state, "")
            .await
            .contains("status=connected")
    );
    assert!(
        callback(&app, &state, "")
            .await
            .contains("reason=reused_state")
    );
    let (status, body) = export(&app, &key).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["accessToken"], "first-token");
    Mock::given(method("GET"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer first-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"tools": []})))
        .with_priority(1)
        .expect(1)
        .mount(&vendor)
        .await;
    let resource = reqwest::Client::new()
        .get(format!("{}/mcp", vendor.uri()))
        .bearer_auth(body["accessToken"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resource.status(), reqwest::StatusCode::OK);
    let (_, state) = start(&app, &key, "https://customer.example/done").await;
    sqlx::query(
        "UPDATE oauth_states SET expires_at = now() - interval '1 second' WHERE state = $1",
    )
    .bind(&state)
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        callback(&app, &state, "")
            .await
            .contains("reason=expired_state")
    );
    let (_, state) = start(&app, &key, "https://customer.example/done").await;
    assert!(
        callback(&app, &state, "access_denied")
            .await
            .contains("reason=access_denied")
    );
    vendor.verify().await;
}

#[tokio::test]
async fn dcr_registers_once_and_reconnects() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    let vendor = vendor_server(ClientRegistration::Dcr, 3600, false, 0).await;
    let (app, repository, _) = fixture(
        pool,
        &vendor,
        ClientRegistration::Dcr,
        "https://connect.example",
    );
    let key = repository
        .create_customer_with_origins("Macro", &["https://customer.example".into()])
        .await
        .unwrap();
    for _ in 0..2 {
        let (authorization_url, state) = start(&app, &key, "https://customer.example/done").await;
        assert!(authorization_url.contains("client_id=dynamic-client"));
        assert!(
            callback(&app, &state, "")
                .await
                .contains("status=connected")
        );
    }
    let (status, body) = export(&app, &key).await;
    assert_eq!(status, StatusCode::OK);
    Mock::given(method("GET"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer first-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"tools": []})))
        .with_priority(1)
        .expect(1)
        .mount(&vendor)
        .await;
    let resource = reqwest::Client::new()
        .get(format!("{}/mcp", vendor.uri()))
        .bearer_auth(body["accessToken"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resource.status(), reqwest::StatusCode::OK);
    vendor.verify().await;
}

#[tokio::test]
async fn own_app_refreshes_concurrent_exports_once() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    let vendor = vendor_server(ClientRegistration::OwnApp, 30, false, 1).await;
    let (app, repository, _) = fixture(
        pool,
        &vendor,
        ClientRegistration::OwnApp,
        "https://connect.example",
    );
    let key = repository
        .create_customer_with_origins("Macro", &["https://customer.example".into()])
        .await
        .unwrap();
    let (authorization_url, state) = start(&app, &key, "https://customer.example/done").await;
    assert!(authorization_url.contains("client_id=own-client"));
    assert!(
        callback(&app, &state, "")
            .await
            .contains("status=connected")
    );
    let (first, second) = tokio::join!(export(&app, &key), export(&app, &key));
    assert_eq!(first.0, StatusCode::OK);
    assert_eq!(second.0, StatusCode::OK);
    assert_eq!(first.1["accessToken"], "refreshed-token");
    assert_eq!(second.1["accessToken"], "refreshed-token");
    Mock::given(method("GET"))
        .and(path("/mcp"))
        .and(header_matcher("authorization", "Bearer refreshed-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"tools": []})))
        .with_priority(1)
        .expect(1)
        .mount(&vendor)
        .await;
    let resource = reqwest::Client::new()
        .get(format!("{}/mcp", vendor.uri()))
        .bearer_auth(first.1["accessToken"].as_str().unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(resource.status(), reqwest::StatusCode::OK);
    vendor.verify().await;
}

#[tokio::test]
async fn invalid_grant_marks_connection_needs_reauth() {
    let database = TestDatabase::new().await;
    let pool = database.pool().clone();
    let vendor = vendor_server(ClientRegistration::OwnApp, 30, true, 1).await;
    let (app, repository, _) = fixture(
        pool,
        &vendor,
        ClientRegistration::OwnApp,
        "https://connect.example",
    );
    let key = repository
        .create_customer_with_origins("Macro", &["https://customer.example".into()])
        .await
        .unwrap();
    let (_, state) = start(&app, &key, "https://customer.example/done").await;
    assert!(
        callback(&app, &state, "")
            .await
            .contains("status=connected")
    );
    let (status, body) = export(&app, &key).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "needs_reauth");
    let customer_id = repository.authenticate(&key).await.unwrap();
    let connections = repository.list(customer_id, "user-a").await.unwrap();
    assert_eq!(connections[0].status.to_string(), "needs_reauth");
    vendor.verify().await;
}
