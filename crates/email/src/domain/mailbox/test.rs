use super::*;
use email_api_client::domain::models::RateLimitOrigin;
use std::time::Duration;

#[test]
fn provider_backoff_is_preserved_and_auth_failure_does_not_hot_loop() {
    let error = EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(73)),
        origin: RateLimitOrigin::Provider,
    };
    assert_eq!(retry_seconds(&error), 73);
    assert!(retry_seconds(&EmailApiError::AuthRequired) >= 300);
}
