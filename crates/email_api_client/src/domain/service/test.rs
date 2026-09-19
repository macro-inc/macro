use std::time::Duration;

use uuid::Uuid;

use super::super::models::{
    AccessToken, ApiOperationKind, EmailApiError, RateLimitRefusal, TokenError, TokenFreshness,
};
use super::EmailApiClientServiceImpl;
use super::test_support::{Call, FakeRateLimiter, FakeRepository, FakeTokenSource, call_log};

#[tokio::test]
async fn token_failure_stops_before_repository_after_the_quota_check() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Err(TokenError::ReauthRequired)),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    let result = service
        .prepare(Uuid::nil(), ApiOperationKind::GetMessage)
        .await;

    assert_eq!(result, Err(EmailApiError::AuthRequired));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(Uuid::nil(), ApiOperationKind::GetMessage),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
        ]
    );
}

#[tokio::test]
async fn rate_limit_refusal_stops_before_the_token_dance_and_repository() {
    let calls = call_log();
    let retry_after = Duration::from_secs(17);
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Err(RateLimitRefusal::new(Some(retry_after)))),
    );

    let result = service
        .prepare(Uuid::nil(), ApiOperationKind::SendMessage)
        .await;

    assert_eq!(
        result,
        Err(EmailApiError::RateLimited {
            retry_after: Some(retry_after),
            origin: crate::domain::models::RateLimitOrigin::Local,
        })
    );
    // A refused attempt must not pay the token acquisition (SELECT + Redis +
    // possible auth-service refresh + health write).
    assert_eq!(
        *calls.lock().unwrap(),
        vec![Call::RateLimit(Uuid::nil(), ApiOperationKind::SendMessage)]
    );
}

#[tokio::test]
async fn explicit_token_probe_honors_requested_freshness_without_quota_check() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    let result = service
        .get_access_token(Uuid::nil(), TokenFreshness::Fresh)
        .await;

    assert_eq!(result.unwrap().expose_secret(), "access-token");
    assert_eq!(
        *calls.lock().unwrap(),
        vec![Call::Token(Uuid::nil(), TokenFreshness::Fresh)]
    );
}

#[tokio::test]
async fn token_errors_preserve_transient_and_permanent_classification() {
    for (token_error, expected) in [
        (
            TokenError::Transient {
                message: "temporarily unavailable".to_string(),
            },
            EmailApiError::Transient {
                message: "temporarily unavailable".to_string(),
            },
        ),
        (
            TokenError::Permanent {
                message: "invalid token configuration".to_string(),
            },
            EmailApiError::Permanent {
                message: "invalid token configuration".to_string(),
            },
        ),
    ] {
        let calls = call_log();
        let service = EmailApiClientServiceImpl::new(
            FakeRepository::new(calls.clone()),
            FakeTokenSource::new(calls.clone(), Err(token_error)),
            FakeRateLimiter::new(calls, Ok(())),
        );

        assert_eq!(
            service
                .get_access_token(Uuid::nil(), TokenFreshness::Cached)
                .await,
            Err(expected)
        );
    }
}
