use super::*;

#[tokio::test]
async fn contended_comment_is_retryable_without_exposing_the_database_cause() {
    let response = CommentOnTextError::from(TextCommentError::Message(MessageError::Contended(
        rootcause::report!("private database detail"),
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
        serde_json::json!({"message": "conversation is busy; retry the request"})
    );
}
