use std::sync::{Arc, Mutex};
use std::time::Duration;

use models_email::email::service::label::Label;
use uuid::Uuid;

use super::super::models::{
    AccessToken, ApiOperationKind, EmailApiError, RateLimitOrigin, RateLimitRefusal, TokenError,
    TokenFreshness,
};
use super::super::ports::MailboxLabelClient;
use super::EmailApiClientServiceImpl;
use super::test_support::{Call, FakeGate, FakeRepository, FakeTokenSource, call_log};

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
        Err(EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider,
        })
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
        FakeGate::new(calls.clone(), Ok(())),
    );

    let result = service
        .list_labels(Uuid::nil())
        .await
        .map(|labels| labels.len());
    let calls = calls.lock().unwrap().clone();
    let seen = seen.lock().unwrap().clone();
    (result, calls, seen)
}

#[tokio::test]
async fn a_rejected_cached_token_is_retried_with_a_fresh_one() {
    let (result, calls, seen) =
        list_labels_with(vec!["cached"], Ok(AccessToken::new("fresh"))).await;

    assert_eq!(result, Ok(0));
    assert_eq!(
        calls,
        vec![
            Call::Acquire(Uuid::nil(), ApiOperationKind::ListLabels),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::Finish(Uuid::nil(), Some(EmailApiError::AuthRequired)),
            Call::Acquire(Uuid::nil(), ApiOperationKind::ListLabels),
            Call::Token(Uuid::nil(), TokenFreshness::Fresh),
            Call::Finish(Uuid::nil(), None),
        ]
    );
    assert_eq!(seen, ["cached", "fresh"]);
}

#[tokio::test]
async fn a_revoked_grant_found_by_the_fresh_fetch_stops_the_read() {
    let (result, calls, seen) =
        list_labels_with(vec!["cached"], Err(TokenError::ReauthRequired)).await;

    assert_eq!(result, Err(EmailApiError::AuthRequired));
    assert_eq!(
        calls,
        vec![
            Call::Acquire(Uuid::nil(), ApiOperationKind::ListLabels),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::Finish(Uuid::nil(), Some(EmailApiError::AuthRequired)),
            Call::Acquire(Uuid::nil(), ApiOperationKind::ListLabels),
            Call::Token(Uuid::nil(), TokenFreshness::Fresh),
            Call::Finish(Uuid::nil(), None),
        ]
    );
    assert_eq!(seen, ["cached"]);
}

#[tokio::test]
async fn a_rejected_fresh_token_is_not_retried_again() {
    let (result, calls, seen) =
        list_labels_with(vec!["cached", "fresh"], Ok(AccessToken::new("fresh"))).await;

    assert_eq!(result, Err(EmailApiError::AuthRequired));
    assert_eq!(
        calls,
        vec![
            Call::Acquire(Uuid::nil(), ApiOperationKind::ListLabels),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::Finish(Uuid::nil(), Some(EmailApiError::AuthRequired)),
            Call::Acquire(Uuid::nil(), ApiOperationKind::ListLabels),
            Call::Token(Uuid::nil(), TokenFreshness::Fresh),
            Call::Finish(Uuid::nil(), Some(EmailApiError::AuthRequired)),
        ]
    );
    assert_eq!(seen, ["cached", "fresh"]);
}

#[tokio::test]
async fn token_failure_releases_admission_without_calling_the_provider() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Err(TokenError::ReauthRequired)),
        FakeGate::new(calls.clone(), Ok(())),
    );

    let result = service
        .modify_message_labels(Uuid::nil(), "message-1", &[], &["INBOX".to_string()])
        .await;

    assert_eq!(result, Err(EmailApiError::AuthRequired));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(Uuid::nil(), ApiOperationKind::ModifyMessageLabels),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::Finish(Uuid::nil(), None),
        ]
    );
}

#[tokio::test]
async fn admission_refusal_stops_before_the_token_dance_and_repository() {
    let calls = call_log();
    let retry_after = Duration::from_secs(17);
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeGate::new(calls.clone(), Err(RateLimitRefusal::new(Some(retry_after)))),
    );

    let result = service.get_thread_count(Uuid::nil()).await;

    assert_eq!(
        result,
        Err(EmailApiError::RateLimited {
            retry_after: Some(retry_after),
            origin: RateLimitOrigin::Local,
        })
    );
    // A refused attempt holds no permit and must not pay the token acquisition
    // (SELECT + Redis + possible auth-service refresh + health write).
    assert_eq!(
        *calls.lock().unwrap(),
        vec![Call::Acquire(Uuid::nil(), ApiOperationKind::GetProfile)]
    );
}

#[tokio::test]
async fn a_provider_rate_limit_is_reported_to_the_gate_when_releasing_admission() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        TokenCheckingLabels::default(),
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeGate::new(calls.clone(), Ok(())),
    );
    let throttled = EmailApiError::RateLimited {
        retry_after: None,
        origin: RateLimitOrigin::Provider,
    };

    let result = service.create_label(Uuid::nil(), "Receipts").await;

    assert_eq!(result.err(), Some(throttled.clone()));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(Uuid::nil(), ApiOperationKind::CreateLabel),
            Call::Token(Uuid::nil(), TokenFreshness::Cached),
            Call::Finish(Uuid::nil(), Some(throttled)),
        ]
    );
}

#[tokio::test]
async fn explicit_token_probe_honors_requested_freshness_without_admission() {
    let calls = call_log();
    let service = EmailApiClientServiceImpl::new(
        FakeRepository::new(calls.clone()),
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeGate::new(calls.clone(), Ok(())),
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
            FakeGate::new(calls, Ok(())),
        );

        assert_eq!(
            service
                .get_access_token(Uuid::nil(), TokenFreshness::Cached)
                .await,
            Err(expected)
        );
    }
}
