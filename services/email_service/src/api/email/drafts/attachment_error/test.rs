use super::*;

#[test]
fn a_busy_inbox_answers_service_unavailable_with_a_retry_time() {
    let response = AttachmentApiError(AttachmentError::Contended).into_response();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[RETRY_AFTER], "5");
}

#[test]
fn a_stale_draft_keeps_its_conflict() {
    let response = AttachmentApiError(AttachmentError::DeliveryConflict).into_response();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(response.headers().get(RETRY_AFTER).is_none());
}

#[tokio::test]
async fn content_limits_are_coded_413_without_a_retry_hint() {
    let response = AttachmentApiError(AttachmentError::ContentTooLarge).into_response();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(response.headers().get(RETRY_AFTER).is_none());
    let bytes = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["code"], "message_too_large");
}
