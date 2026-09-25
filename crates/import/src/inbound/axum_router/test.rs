use super::*;
use ai_billing::domain::{AiAdmissionError, DenyReason};
use axum::body::to_bytes;

#[tokio::test]
async fn admission_denials_return_payment_required_with_stable_codes() {
    for reason in [
        DenyReason::AllowanceExhausted,
        DenyReason::OverageLimitReached,
        DenyReason::OveragePaymentFailed,
    ] {
        let response = error_response(ImportError::Admission(AiAdmissionError::Denied(reason)));
        assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "code": reason.code(),
                "error": reason.message(),
            })
        );
    }
}

#[tokio::test]
async fn unavailable_billing_is_retryable_and_does_not_leak_storage_details() {
    let response = error_response(ImportError::Admission(AiAdmissionError::Unavailable(
        rootcause::report!("private billing database failure"),
    )));
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "code": "ai_billing_unavailable",
            "error": "AI billing is unavailable. Please try again.",
        })
    );
}

#[test]
fn unrelated_errors_keep_the_existing_internal_error_response() {
    assert_eq!(
        error_response(ImportError::Other(anyhow::anyhow!("other failure"))).status(),
        StatusCode::INTERNAL_SERVER_ERROR,
    );
}
