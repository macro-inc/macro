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
