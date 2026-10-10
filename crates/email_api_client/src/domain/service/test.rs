use std::cell::RefCell;
use std::sync::Once;
use std::time::Duration;

use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::{Layer, Registry};
use uuid::Uuid;

use super::super::models::{
    AccessToken, ApiOperationKind, EmailApiError, RateLimitOrigin, RateLimitRefusal, TokenError,
    TokenFreshness,
};
use super::EmailApiClientServiceImpl;
use super::test_support::{Call, FakeRateLimiter, FakeRepository, FakeTokenSource, call_log};

thread_local! {
    static CAPTURED_LEVELS: RefCell<Option<Vec<Level>>> = const { RefCell::new(None) };
}

/// Records event levels on threads with an active [`LevelCapture`].
///
/// It is installed as the process-wide default because a thread-scoped
/// default races with other test threads: a callsite they register first can
/// cache "never" and drop this thread's events.
struct CapturedLevelsLayer;

impl<S: Subscriber> Layer<S> for CapturedLevelsLayer {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        CAPTURED_LEVELS.with_borrow_mut(|levels| {
            if let Some(levels) = levels {
                levels.push(*event.metadata().level());
            }
        });
    }
}

/// Records the levels of events logged on this thread until dropped.
struct LevelCapture;

impl LevelCapture {
    fn start() -> Self {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            tracing::subscriber::set_global_default(Registry::default().with(CapturedLevelsLayer))
                .expect("no other test installs a global subscriber");
        });
        CAPTURED_LEVELS.set(Some(Vec::new()));
        Self
    }

    fn most_severe(&self) -> Option<Level> {
        // `tracing` orders levels by verbosity, so the most severe is the minimum.
        CAPTURED_LEVELS.with_borrow(|levels| levels.iter().flatten().min().copied())
    }
}

impl Drop for LevelCapture {
    fn drop(&mut self) {
        CAPTURED_LEVELS.set(None);
    }
}

/// Runs a failing `get_message` and returns the most severe level it logged.
async fn most_severe_level_logged(
    rate_limit: Result<(), RateLimitRefusal>,
    token: Result<AccessToken, TokenError>,
    provider_error: EmailApiError,
) -> Option<Level> {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::failing_with(calls.clone(), provider_error),
        FakeTokenSource::new(calls.clone(), token),
        FakeRateLimiter::new(calls, rate_limit),
    );
    let capture = LevelCapture::start();

    assert!(
        service
            .get_message(Uuid::nil(), "message-id")
            .await
            .is_err()
    );

    capture.most_severe()
}

#[tokio::test]
async fn only_local_rate_limit_refusals_log_below_error() {
    let token = Ok(AccessToken::new("access-token"));
    let provider_failure = EmailApiError::Permanent {
        message: "provider failure".to_string(),
    };
    let provider_throttle = EmailApiError::RateLimited {
        retry_after: Some(Duration::from_secs(5)),
        origin: RateLimitOrigin::Provider,
    };

    for (case, rate_limit, token, provider_error, expected) in [
        (
            "local refusal",
            Err(RateLimitRefusal::new(None)),
            token.clone(),
            provider_failure.clone(),
            Level::DEBUG,
        ),
        (
            "provider throttling",
            Ok(()),
            token.clone(),
            provider_throttle,
            Level::ERROR,
        ),
        (
            "token failure",
            Ok(()),
            Err(TokenError::ReauthRequired),
            provider_failure.clone(),
            Level::ERROR,
        ),
        (
            "provider failure",
            Ok(()),
            token,
            provider_failure,
            Level::ERROR,
        ),
    ] {
        assert_eq!(
            most_severe_level_logged(rate_limit, token, provider_error).await,
            Some(expected),
            "{case}"
        );
    }
}

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
