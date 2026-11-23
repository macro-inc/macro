use super::openai_error_code;
use genai_telemetry::provider_account::{AccountUnavailable, account_unavailable};

#[test]
fn insufficient_quota_is_classified_by_its_code() {
    let body = br#"{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}"#;

    assert_eq!(
        account_unavailable(
            Some(429),
            openai_error_code(body).as_deref().unwrap_or_default()
        ),
        Some(AccountUnavailable::OutOfCredit)
    );
}

#[test]
fn suspension_text_echoed_from_the_request_is_not_classified() {
    let body = br#"{"error":{"message":"The model `this account is suspended` does not exist or you do not have access to it.","type":"invalid_request_error","param":null,"code":"model_not_found"}}"#;

    assert_eq!(
        account_unavailable(
            Some(404),
            openai_error_code(body).as_deref().unwrap_or_default()
        ),
        None
    );
}
