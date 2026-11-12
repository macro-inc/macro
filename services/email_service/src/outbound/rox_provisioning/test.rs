use super::*;
use axum::{
    Json, Router,
    http::{HeaderMap, StatusCode},
    routing::post,
};

#[tokio::test]
async fn provisions_through_the_existing_contract_with_bearer_auth() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().route(
        "/api/provision",
        post(|headers: HeaderMap| async move {
            assert_eq!(
                headers
                    .get(axum::http::header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok()),
                Some("Bearer loopback-rox-token")
            );
            Json(serde_json::json!({
                "address": "ada@rox.one",
                "username": "ada@rox.one",
                "password": "loopback-only-password",
                "jmapUrl": "http://127.0.0.1/jmap"
            }))
        }),
    );
    let server = tokio::spawn(axum::serve(listener, app).into_future());

    let mailbox = RoxMailboxProvisioner::new(
        reqwest::Url::parse(&format!("{origin}/api/provision")).unwrap(),
    )
    .provision("loopback-rox-token")
    .await
    .unwrap();

    assert_eq!(mailbox.address, "ada@rox.one");
    assert_eq!(mailbox.username, "ada@rox.one");
    assert_eq!(mailbox.jmap_url, "http://127.0.0.1/jmap");
    assert_eq!(mailbox.password(), "loopback-only-password");
    server.abort();
}

#[tokio::test]
async fn unauthorized_response_does_not_read_or_expose_a_body() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().route(
        "/api/provision",
        post(|| async {
            (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"password": "must-not-be-read"})),
            )
        }),
    );
    let server = tokio::spawn(axum::serve(listener, app).into_future());

    let error = match RoxMailboxProvisioner::new(
        reqwest::Url::parse(&format!("{origin}/api/provision")).unwrap(),
    )
    .provision("loopback-rox-token")
    .await
    {
        Err(error) => error,
        Ok(_) => panic!("unauthorized provisioning unexpectedly succeeded"),
    };

    assert!(matches!(error, RoxProvisioningError::Unauthorized));
    assert!(!error.to_string().contains("must-not-be-read"));
    server.abort();
}
