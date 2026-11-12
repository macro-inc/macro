use super::*;

#[tokio::test]
async fn contended_write_is_retryable_without_exposing_the_database_cause() {
    let response = MessageHttpError::from(MessageError::Contended(rootcause::report!(
        "private database detail"
    )))
    .into_response();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[RETRY_AFTER], "1");
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"message": "channel is busy; retry the request"})
    );
}

#[tokio::test]
async fn other_repository_failures_remain_internal_errors() {
    let response = MessageHttpError::from(MessageError::Repository(rootcause::report!(
        "private database detail"
    )))
    .into_response();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!response.headers().contains_key(RETRY_AFTER));
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"message": "message operation failed"})
    );
}
