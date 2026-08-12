use super::*;

use axum::body::Body;
use axum::http::Request;
use tower::ServiceExt;

fn app() -> Router {
    router(ApiContext {
        registry: RelayRegistry::default(),
        secret: Arc::new("s3cret".to_owned()),
    })
}

fn notification_request(token: Option<&str>, complete: bool) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/calendar/notifications");
    if let Some(token) = token {
        builder = builder.header("x-goog-channel-token", token);
    }
    if complete {
        builder = builder
            .header("x-goog-resource-state", "exists")
            .header("x-goog-channel-id", "chan-1")
            .header("x-goog-resource-id", "res-1");
    }
    builder.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn health_answers_ok() {
    let response = app()
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn notifications_require_a_token_and_the_goog_headers() {
    let app = app();
    let missing_token = app
        .clone()
        .oneshot(notification_request(None, true))
        .await
        .unwrap();
    assert_eq!(missing_token.status(), StatusCode::FORBIDDEN);

    let missing_headers = app
        .clone()
        .oneshot(notification_request(Some("t"), false))
        .await
        .unwrap();
    assert_eq!(missing_headers.status(), StatusCode::BAD_REQUEST);

    let stray = app
        .oneshot(notification_request(Some("nobody-listening"), true))
        .await
        .unwrap();
    assert_eq!(stray.status(), StatusCode::OK, "strays are acknowledged");
}

#[tokio::test]
async fn subscribe_requires_the_shared_secret_and_a_token() {
    let app = app();
    let wrong_secret = app
        .clone()
        .oneshot(
            Request::get("/calendar/relay/subscribe")
                .header("x-relay-secret", "wrong")
                .header("x-relay-token", "t")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_secret.status(), StatusCode::FORBIDDEN);

    let missing_token = app
        .oneshot(
            Request::get("/calendar/relay/subscribe")
                .header("x-relay-secret", "s3cret")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_token.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_delivery_reaches_a_live_subscriber_as_an_sse_event() {
    let state = ApiContext {
        registry: RelayRegistry::default(),
        secret: Arc::new("s3cret".to_owned()),
    };
    let subscription = router(state.clone())
        .oneshot(
            Request::get("/calendar/relay/subscribe")
                .header("x-relay-secret", "s3cret")
                .header("x-relay-token", "token-e2e")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(subscription.status(), StatusCode::OK);

    let delivery = router(state)
        .oneshot(notification_request(Some("token-e2e"), true))
        .await
        .unwrap();
    assert_eq!(delivery.status(), StatusCode::OK);

    let frame = tokio::time::timeout(
        Duration::from_secs(5),
        subscription.into_body().into_data_stream().next(),
    )
    .await
    .expect("a frame arrives promptly")
    .expect("the stream is open")
    .unwrap();
    let text = String::from_utf8(frame.to_vec()).unwrap();
    assert!(text.starts_with("data:"), "unexpected frame: {text}");
    let payload: RelayedWatchNotification =
        serde_json::from_str(text.trim_start_matches("data:").trim()).unwrap();
    assert_eq!(payload.channel_id, "chan-1");
    assert_eq!(payload.resource_id, "res-1");
    assert_eq!(payload.state, "exists");
}
