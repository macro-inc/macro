use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};

use chrono::{TimeZone, Utc};
use models_email::service::link::{Link, UserProvider};
use uuid::Uuid;

use super::super::super::models::{
    AccessToken, EmailApiError, ProviderSubscription, SyncCursor, TokenFreshness,
};
use super::super::super::ports::MailboxSubscriptionClient;
use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, call_log};
use super::EmailApiClientServiceImpl;

#[derive(Clone)]
struct SubscriptionClient {
    calls: super::super::test_support::CallLog,
}

impl MailboxSubscriptionClient for SubscriptionClient {
    async fn subscribe(&self, _: &AccessToken) -> Result<ProviderSubscription, EmailApiError> {
        self.record("subscribe");
        Ok(ProviderSubscription::new(
            SyncCursor::gmail("cursor-1"),
            Utc.timestamp_opt(1_800_000_000, 0).unwrap(),
        ))
    }

    async fn unsubscribe(&self, _: &AccessToken) -> Result<(), EmailApiError> {
        self.record("unsubscribe");
        Ok(())
    }
}

impl SubscriptionClient {
    fn record(&self, method: &'static str) {
        self.calls.lock().unwrap().push(Call::Repository(method));
    }
}

#[test]
fn registration_and_stop_use_matching_costs_and_operations() {
    for (register, operation, repository_call) in [
        (true, super::ApiOperationKind::Subscribe, "subscribe"),
        (false, super::ApiOperationKind::Unsubscribe, "unsubscribe"),
    ] {
        let calls = call_log();
        let service = service(calls.clone());

        if register {
            let subscription = block_on(service.register_subscription(Uuid::nil())).unwrap();
            assert_eq!(subscription.cursor, SyncCursor::gmail("cursor-1"));
        } else {
            block_on(service.stop_subscription(Uuid::nil())).unwrap();
        }

        assert_eq!(
            *calls.lock().unwrap(),
            vec![
                Call::RateLimit(Uuid::nil(), operation),
                Call::Token(Uuid::nil(), TokenFreshness::Cached),
                Call::Repository(repository_call),
            ]
        );
    }
}

#[test]
fn registration_can_bypass_the_token_cache_for_initialization() {
    let calls = call_log();
    let service = service(calls.clone());

    block_on(service.register_subscription_without_cache(&link())).unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(Uuid::nil(), super::ApiOperationKind::Subscribe),
            Call::Token(Uuid::nil(), TokenFreshness::Fresh),
            Call::Repository("subscribe"),
        ]
    );
}

#[test]
fn teardown_stop_uses_the_health_neutral_token_path() {
    let calls = call_log();
    let service = service(calls.clone());

    block_on(service.stop_subscription_for_link(&link())).unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(Uuid::nil(), super::ApiOperationKind::Unsubscribe),
            Call::HealthNeutralToken(Uuid::nil(), TokenFreshness::Cached),
            Call::Repository("unsubscribe"),
        ]
    );
}

fn link() -> Link {
    Link {
        id: Uuid::nil(),
        macro_id: "macro|user@example.com".to_string().try_into().unwrap(),
        fusionauth_user_id: "fusion-user-id".to_string(),
        email_address: "user@example.com".to_string().try_into().unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: true,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    }
}

fn service(
    calls: super::super::test_support::CallLog,
) -> EmailApiClientServiceImpl<SubscriptionClient, FakeTokenSource, FakeRateLimiter> {
    EmailApiClientServiceImpl::new(
        SubscriptionClient {
            calls: calls.clone(),
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls, Ok(())),
    )
}

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
