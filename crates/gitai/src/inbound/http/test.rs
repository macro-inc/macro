use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use axum::routing::post;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::fakes::{SHARED_KEY, fixture_body, service};

async fn status_for_body_of(len: usize) -> StatusCode {
    let routes = with_worker_body_limit(Router::new().route(
        "/upload",
        post(|body: Bytes| async move { body.len().to_string() }),
    ));
    let request = Request::post("/upload")
        .body(Body::from(vec![b'x'; len]))
        .unwrap();
    routes.oneshot(request).await.unwrap().status()
}

#[tokio::test]
async fn worker_routes_accept_bodies_up_to_64_mb() {
    // Above axum's 2 MB default, so the explicit limit is what admits it.
    assert_eq!(status_for_body_of(8 * 1024 * 1024).await, StatusCode::OK);
    assert_eq!(
        status_for_body_of(WORKER_BODY_LIMIT_BYTES).await,
        StatusCode::OK
    );
    assert_eq!(
        status_for_body_of(WORKER_BODY_LIMIT_BYTES + 1).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

async fn call(app: &Router, request: Request<Body>) -> (StatusCode, HeaderMap, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, headers, body)
}

fn request(method: &str, uri: &str, key: Option<&str>, body: Body) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("user-agent", "git-ai/1.7.7")
        .header("content-type", "application/json");
    if let Some(key) = key {
        builder = builder.header("x-api-key", key);
    }
    builder.body(body).unwrap()
}

async fn mint(app: &Router) -> (String, String) {
    let (status, _, body) = call(
        app,
        request(
            "POST",
            "/v1/credentials",
            Some(SHARED_KEY),
            Body::from(json!({"email": "dev@example.com", "hostname": "laptop-1"}).to_string()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    (
        body["id"].as_str().unwrap().to_owned(),
        body["credential"].as_str().unwrap().to_owned(),
    )
}

#[tokio::test]
async fn credentials_are_minted_listed_and_revoked_over_http() {
    let (service, _, _, _) = service();
    let app = router(Arc::new(service));
    let (id, credential) = mint(&app).await;

    let (status, _, body) = call(
        &app,
        request("GET", "/v1/whoami", Some(&credential), Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"id": id, "email": "dev@example.com", "hostname": "laptop-1"})
    );

    let (status, _, body) = call(
        &app,
        request("GET", "/v1/credentials", Some(SHARED_KEY), Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let listed = &body["credentials"][0];
    assert_eq!(listed["id"], id.as_str());
    assert!(listed.get("credential").is_none());
    assert_eq!(listed["revoked_at"], Value::Null);

    let uri = format!("/v1/credentials/{id}");
    let (status, _, _) = call(
        &app,
        request("DELETE", &uri, Some(SHARED_KEY), Body::empty()),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let upload = Body::from(fixture_body("metrics-upload-mixed.json"));
    let (status, _, body) = call(
        &app,
        request("POST", "/worker/metrics/upload", Some(&credential), upload),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({"error": "unauthorized"}));
}

#[tokio::test]
async fn keys_only_open_their_own_routes() {
    let (service, _, _, _) = service();
    let app = router(Arc::new(service));
    let (_, credential) = mint(&app).await;

    let upload = || Body::from(fixture_body("metrics-upload-mixed.json"));
    for (method, uri, key, body) in [
        ("POST", "/worker/metrics/upload", Some(SHARED_KEY), upload()),
        ("POST", "/worker/metrics/upload", None, upload()),
        ("GET", "/v1/whoami", Some(SHARED_KEY), Body::empty()),
        ("GET", "/worker/releases", Some(SHARED_KEY), Body::empty()),
        (
            "GET",
            "/v1/credentials",
            Some(credential.as_str()),
            Body::empty(),
        ),
        (
            "POST",
            "/v1/credentials",
            Some(credential.as_str()),
            Body::from("{}"),
        ),
        ("DELETE", "/v1/credentials/not-a-uuid", None, Body::empty()),
    ] {
        let (status, _, _) = call(&app, request(method, uri, key, body)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

#[tokio::test]
async fn client_routes_answer_in_the_shapes_git_ai_parses() {
    let (service, _, _, _) = service();
    let app = router(Arc::new(service));
    let (_, credential) = mint(&app).await;
    let key = Some(credential.as_str());

    let upload = Body::from(fixture_body("metrics-upload-mixed.json"));
    let (status, _, body) =
        call(&app, request("POST", "/worker/metrics/upload", key, upload)).await;
    assert_eq!((status, body), (StatusCode::OK, json!({"errors": []})));

    let logs = Body::from(fixture_body("logs-upload.json"));
    let (status, _, body) = call(&app, request("POST", "/worker/logs/upload", key, logs)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({"accepted": 2, "dropped": 0, "enqueued": true, "errors": []})
    );

    let sha = "9237c8c1cdf2a07152059eaa8a61592efe1d1d86";
    let (status, _, body) = call(
        &app,
        request(
            "GET",
            &format!("/worker/notes/?commits={sha}"),
            key,
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body["notes"][sha]
            .as_str()
            .unwrap()
            .contains("authorship/3.0.0")
    );

    let unknown = "0000000000000000000000000000000000000000";
    let (status, _, body) = call(
        &app,
        request(
            "GET",
            &format!("/worker/notes?commits={unknown}"),
            key,
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, json!({"notes": {}}))
    );

    let (status, _, body) =
        call(&app, request("GET", "/worker/releases", key, Body::empty())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["channels"]["latest"]["version"], "v1.7.6");
    assert_eq!(body["channels"]["enterprise-next"]["version"], "v1.7.6");

    let (status, _, body) = call(
        &app,
        request("POST", "/worker/metrics/upload", key, Body::from("nope")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn release_downloads_redirect_without_a_credential() {
    let (service, _, _, _) = service();
    let app = router(Arc::new(service));
    let (status, headers, _) = call(
        &app,
        request(
            "GET",
            "/worker/releases/latest/download/install.sh",
            None,
            Body::empty(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FOUND);
    assert_eq!(
        headers["location"],
        "https://github.com/git-ai-project/git-ai/releases/download/v1.7.6/install.sh"
    );
}

#[tokio::test]
async fn oauth_and_vendor_api_routes_do_not_exist() {
    let (service, _, _, _) = service();
    let app = router(Arc::new(service));
    for (method, uri) in [
        ("POST", "/worker/oauth/device/code"),
        ("POST", "/worker/oauth/token"),
        ("POST", "/api/bundles"),
        ("GET", "/api/cube/load"),
    ] {
        let (status, _, _) = call(
            &app,
            request(method, uri, Some(SHARED_KEY), Body::from("{}")),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
    }
}
