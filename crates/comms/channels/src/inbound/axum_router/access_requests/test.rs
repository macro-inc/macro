use super::*;
use axum::body::to_bytes;

#[tokio::test]
async fn repository_failure_does_not_expose_internal_details() {
    let response = ChannelAccessRequestErr::Repo(anyhow::anyhow!(
        "database connection failed: internal-host:5432"
    ))
    .into_response();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({ "message": "internal server error" })
    );
}
