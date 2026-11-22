use super::pipedream_webhook_router;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

const SECRET: &str = "s3cret";
const SUCCESS_BODY: &str = r#"{"event":"CONNECTION_SUCCESS"}"#;

fn router() -> axum::Router {
    pipedream_webhook_router(SECRET.to_owned())
}

async fn post_webhook(uri: &str, body: &'static str) -> StatusCode {
    router()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn webhook_rejects_missing_secret() {
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook", SUCCESS_BODY).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn webhook_rejects_wrong_secret() {
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook?secret=wrong", SUCCESS_BODY).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn webhook_accepts_matching_secret() {
    assert_eq!(
        post_webhook("/pipedream/mcp/webhook?secret=s3cret", SUCCESS_BODY).await,
        StatusCode::NO_CONTENT
    );
}
