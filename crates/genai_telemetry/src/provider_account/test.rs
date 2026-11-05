use super::{AccountUnavailable, account_unavailable};

#[test]
fn fireworks_suspension_is_suspended() {
    assert_eq!(
        account_unavailable(
            Some(412),
            r#"{"error":{"object":"error","type":"invalid_request_error","message":"Account acct-example1 is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices."}}"#,
        ),
        Some(AccountUnavailable::Suspended)
    );
}

#[test]
fn gemini_suspended_consumer_is_suspended() {
    assert_eq!(
        account_unavailable(
            Some(403),
            r#"{"error":{"code":403,"message":"Permission denied: Consumer 'api_key:AIza' has been suspended.","status":"PERMISSION_DENIED","details":[{"reason":"CONSUMER_SUSPENDED"}]}}"#,
        ),
        Some(AccountUnavailable::Suspended)
    );
}

#[test]
fn openai_deactivated_account_is_suspended() {
    assert_eq!(
        account_unavailable(
            Some(401),
            r#"{"error":{"message":"This key is associated with a deactivated account.","type":"invalid_request_error","code":"account_deactivated"}}"#,
        ),
        Some(AccountUnavailable::Suspended)
    );
}

#[test]
fn anthropic_low_credit_is_out_of_credit() {
    assert_eq!(
        account_unavailable(
            Some(400),
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}"#,
        ),
        Some(AccountUnavailable::OutOfCredit)
    );
}

#[test]
fn anthropic_usage_limit_is_out_of_credit() {
    assert_eq!(
        account_unavailable(
            Some(400),
            r#"{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."}}"#,
        ),
        Some(AccountUnavailable::OutOfCredit)
    );
}

#[test]
fn openai_insufficient_quota_is_out_of_credit() {
    assert_eq!(
        account_unavailable(
            Some(429),
            r#"{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}"#,
        ),
        Some(AccountUnavailable::OutOfCredit)
    );
}

#[test]
fn payment_required_is_out_of_credit() {
    assert_eq!(
        account_unavailable(Some(402), r#"{"message":"Payment required"}"#),
        Some(AccountUnavailable::OutOfCredit)
    );
}

#[test]
fn openai_code_without_status_is_out_of_credit() {
    assert_eq!(
        account_unavailable(
            None,
            "insufficient_quota: You exceeded your current quota, please check your plan and billing details."
        ),
        Some(AccountUnavailable::OutOfCredit)
    );
}

#[test]
fn gemini_per_minute_quota_is_a_rate_limit() {
    assert_eq!(
        account_unavailable(
            Some(429),
            r#"{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_paid_tier_input_token_count, limit: 4000000","status":"RESOURCE_EXHAUSTED"}}"#,
        ),
        None
    );
}

#[test]
fn anthropic_rate_limit_is_not_an_account_failure() {
    assert_eq!(
        account_unavailable(
            Some(429),
            r#"{"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}"#,
        ),
        None
    );
}

#[test]
fn server_error_quoting_suspension_is_not_an_account_failure() {
    assert_eq!(
        account_unavailable(Some(500), "upstream account is suspended"),
        None
    );
}
