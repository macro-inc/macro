use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};
use std::time::Duration;

use uuid::Uuid;

use super::super::models::{
    AccessToken, ApiOperationKind, EmailApiError, RateLimitRefusal, TokenError, TokenFreshness,
};
use super::EmailApiClientServiceImpl;
use super::test_support::{Call, FakeRateLimiter, FakeRepository, FakeTokenSource, call_log};

struct NoopWaker;

impl Wake for NoopWaker {
    fn wake(self: Arc<Self>) {}
}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(NoopWaker));
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);

    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(output) => return output,
            Poll::Pending => std::thread::yield_now(),
        }
    }
}

#[test]
fn token_failure_stops_before_rate_limit_and_repository() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Err(TokenError::ReauthRequired)),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    let result = block_on(service.prepare(Uuid::nil(), ApiOperationKind::GetMessage));

    assert_eq!(result, Err(EmailApiError::AuthRequired));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![Call::Token(Uuid::nil(), TokenFreshness::Cached)]
    );
}

#[test]
fn rate_limit_refusal_stops_before_repository() {
    let calls = call_log();
    let retry_after = Duration::from_secs(17);
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Err(RateLimitRefusal::new(Some(retry_after)))),
    );

    let result = block_on(service.prepare(Uuid::nil(), ApiOperationKind::SendMessage));

    assert_eq!(
        result,
        Err(EmailApiError::RateLimited {
            retry_after: Some(retry_after),
        })
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::RateLimit(Uuid::nil(), ApiOperationKind::SendMessage),
        ]
    );
}

#[test]
fn explicit_token_probe_honors_requested_freshness_without_quota_check() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    let result = block_on(service.get_access_token(Uuid::nil(), TokenFreshness::Fresh));

    assert_eq!(result.unwrap().expose_secret(), "access-token");
    assert_eq!(
        *calls.lock().unwrap(),
        vec![Call::Token(Uuid::nil(), TokenFreshness::Fresh)]
    );
}

#[test]
fn token_errors_preserve_transient_and_permanent_classification() {
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
            block_on(service.get_access_token(Uuid::nil(), TokenFreshness::Cached)),
            Err(expected)
        );
    }
}
