use super::*;
use crate::domain::DenyReason;
use axum::body::to_bytes;
use serde_json::json;

async fn assert_response(error: AiAdmissionError, status: StatusCode, expected: serde_json::Value) {
    let (mapped_status, Json(body)) = admission_error_response(&error);
    assert_eq!(mapped_status, status);
    assert_eq!(serde_json::to_value(&body).unwrap(), expected);
    assert_eq!(
        serde_json::to_value(AiAdmissionErrorBody::from(&error)).unwrap(),
        expected
    );

    let response = error.into_response();
    assert_eq!(response.status(), status);
    assert_eq!(response.headers()["content-type"], "application/json");
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        expected
    );
    assert_eq!(bytes.as_ref(), serde_json::to_vec(&body).unwrap());
}

#[tokio::test]
async fn denials_preserve_all_three_public_codes_and_messages() {
    for (reason, code, message) in [
        (
            DenyReason::AllowanceExhausted,
            "ai_allowance_exhausted",
            "You've used this period's included AI. Add credits, turn on usage billing, or upgrade to keep going.",
        ),
        (
            DenyReason::OverageLimitReached,
            "ai_overage_limit_reached",
            "You've reached your AI spending limit for this period. Raise the limit or add credits to keep going.",
        ),
        (
            DenyReason::OveragePaymentFailed,
            "ai_overage_payment_failed",
            "Your last AI usage charge didn't go through. Update your payment method and re-enable usage billing.",
        ),
    ] {
        assert_response(
            AiAdmissionError::Denied(reason),
            StatusCode::PAYMENT_REQUIRED,
            json!({ "error": message, "code": code }),
        )
        .await;
    }
}

#[tokio::test]
async fn unavailable_is_retryable_and_never_exposes_diagnostics() {
    for diagnostic in [
        "Postgres connection failed: private-db.internal; table ai_billing_settings",
        "Stripe request failed: cus_private_customer; payer macro|private@example.com",
        "AI admission service is not configured",
    ] {
        let error = AiAdmissionError::Unavailable(rootcause::report!(diagnostic).into());
        assert!(format!("{error:?}").contains(diagnostic));
        assert_response(
            error,
            StatusCode::SERVICE_UNAVAILABLE,
            json!({
                "error": "AI billing is unavailable. Please try again.",
                "code": "ai_billing_unavailable",
            }),
        )
        .await;
    }
}

#[test]
fn serialization_is_stable() {
    let error = AiAdmissionError::Unavailable(rootcause::report!("private details"));
    assert_eq!(
        serde_json::to_string(&AiAdmissionErrorBody::from(&error)).unwrap(),
        r#"{"error":"AI billing is unavailable. Please try again.","code":"ai_billing_unavailable"}"#
    );
}

#[test]
fn openapi_body_has_only_the_public_required_fields() {
    let schema =
        serde_json::to_value(<AiAdmissionErrorBody as utoipa::PartialSchema>::schema()).unwrap();
    assert_eq!(schema["required"], json!(["error", "code"]));
    let properties = schema["properties"].as_object().unwrap();
    assert_eq!(properties.len(), 2);
    assert_eq!(properties["error"]["type"], "string");
    assert_eq!(properties["code"]["type"], "string");
}
