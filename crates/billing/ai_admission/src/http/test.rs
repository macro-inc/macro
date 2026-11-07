use super::*;
use crate::DenyReason;
use axum::body::to_bytes;

#[tokio::test]
async fn denials_preserve_existing_codes_and_messages() {
    for reason in [
        DenyReason::AllowanceExhausted,
        DenyReason::OverageLimitReached,
        DenyReason::OveragePaymentFailed,
    ] {
        let response = AiAdmissionError::Denied(reason).into_response();
        assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"error": reason.message(), "code": reason.code()})
        );
    }
}

#[tokio::test]
async fn unavailable_is_a_sanitized_retryable_503() {
    let error = AiAdmissionError::Unavailable;
    assert!(error.is_retryable());
    let response = error.into_response();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()["content-type"], "application/json");
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "error": "AI usage validation is temporarily unavailable. Please try again.",
            "code": "ai_billing_unavailable"
        })
    );
}
