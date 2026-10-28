use std::sync::{Arc, Mutex};
use std::time::Duration;

use models_email::email::service::label::Label;
use uuid::Uuid;

use super::super::models::{
    AccessToken, ApiOperationKind, EmailApiError, RateLimitRefusal, TokenError, TokenFreshness,
};
use super::super::ports::MailboxLabelClient;
use super::EmailApiClientServiceImpl;
use super::test_support::{Call, FakeRateLimiter, FakeRepository, FakeTokenSource, call_log};

/// Rejects the listed tokens the way Gmail answers a 401.
#[derive(Clone, Default)]
struct TokenCheckingLabels {
    rejected: Vec<&'static str>,
    seen: Arc<Mutex<Vec<String>>>,
}

impl MailboxLabelClient for TokenCheckingLabels {
    async fn list_labels(&self, token: &AccessToken, _: Uuid) -> Result<Vec<Label>, EmailApiError> {
        let token = token.expose_secret();
        self.seen.lock().unwrap().push(token.to_string());
        if self.rejected.contains(&token) {
            Err(EmailApiError::AuthRequired)
        } else {
            Ok(Vec::new())
        }
    }

    async fn create_label(
        &self,
        _: &AccessToken,
        _: Uuid,
        _: &str,
    ) -> Result<Label, EmailApiError> {
        unreachable!("not used by these tests")
    }

    async fn delete_label(&self, _: &AccessToken, _: &str) -> Result<(), EmailApiError> {
        unreachable!("not used by these tests")
    }
}

async fn list_labels_with(
    rejected: Vec<&'static str>,
    fresh: Result<AccessToken, TokenError>,
) -> (Result<usize, EmailApiError>, Vec<Call>, Vec<String>) {
    let calls = call_log();
    let repository = TokenCheckingLabels {
        rejected,
        ..Default::default()
    };
    let seen = repository.seen.clone();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("cached"))).with_fresh(fresh),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    let result = service
        .list_labels(Uuid::nil())
        .await
        .map(|labels| labels.len());
    let calls = calls.lock().unwrap().clone();
    let seen = seen.lock().unwrap().clone();
    (result, calls, seen)
}

fn retried_calls() -> Vec<Call> {
    vec![
        Call::RateLimit(Uuid::nil(), ApiOperationKind::ListLabels),
        Call::Token(Uuid::nil(), TokenFreshness::Cached),
        Call::RateLimit(Uuid::nil(), ApiOperationKind::ListLabels),
        Call::Token(Uuid::nil(), TokenFreshness::Fresh),
    ]
}

#[tokio::test]
async fn a_rejected_cached_token_is_retried_with_a_fresh_one() {
    let (result, calls, seen) =
        list_labels_with(vec!["cached"], Ok(AccessToken::new("fresh"))).await;

    assert_eq!(result, Ok(0));
    assert_eq!(calls, retried_calls());
    assert_eq!(seen, ["cached", "fresh"]);
}

#[tokio::test]
async fn a_revoked_grant_found_by_the_fresh_fetch_stops_the_read() {
    let (result, calls, seen) =
        list_labels_with(vec!["cached"], Err(TokenError::ReauthRequired)).await;

    assert_eq!(result, Err(EmailApiError::AuthRequired));
    assert_eq!(calls, retried_calls());
    assert_eq!(seen, ["cached"]);
}

#[tokio::test]
async fn a_rejected_fresh_token_is_not_retried_again() {
    let (result, calls, seen) =
        list_labels_with(vec!["cached", "fresh"], Ok(AccessToken::new("fresh"))).await;

    assert_eq!(result, Err(EmailApiError::AuthRequired));
    assert_eq!(calls, retried_calls());
    assert_eq!(seen, ["cached", "fresh"]);
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
