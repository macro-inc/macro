use std::ops::Deref;

use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use notification::domain::{
    models::SendNotificationRequest, service::NotificationIngress, service::SendNotificationError,
};
use rate_limit::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
};
use rootcause::Report;

use crate::domain::{
    models::ReferralError,
    ports::{MockDiscountClient, MockReferralRepo, ReferralService},
    service::ReferralServiceImpl,
};

// -- Mock NotificationIngress --

struct MockNotificationIngressInner;

impl NotificationIngress for MockNotificationIngressInner {
    async fn send_notification<
        'a,
        T: notification::domain::models::Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &'a self,
        _req: SendNotificationRequest<'a, T, U>,
    ) -> Result<
        Option<notification::domain::models::NotificationResult<'a>>,
        Report<SendNotificationError>,
    > {
        Ok(None)
    }
}

/// Wrapper that implements `Deref<Target = MockNotificationIngressInner>`
/// to satisfy the `N: Deref<Target = NI>` bound on `ReferralServiceImpl`.
struct MockNotificationIngress(MockNotificationIngressInner);

impl Deref for MockNotificationIngress {
    type Target = MockNotificationIngressInner;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

// -- Mock RateLimitPort --

struct MockRateLimitPort {
    should_exceed: bool,
}

impl rate_limit::RateLimitPort for MockRateLimitPort {
    async fn check(
        &self,
        _key: &RateLimitKey,
        config: &RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        if self.should_exceed {
            Ok(RateLimitResult::Exceeded(RateLimitExceeded {
                key: "test_key".to_string(),
                current_count: config.max_count.saturating_add(1),
                max_count: config.max_count,
                retry_after: config.window,
            }))
        } else {
            Ok(RateLimitResult::Allowed { current_count: 1 })
        }
    }

    async fn increment(
        &self,
        _key: &RateLimitKey,
        _config: &RateLimitConfig,
    ) -> Result<u64, Report> {
        Ok(1)
    }
}

fn allowing_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: false,
        },
    }
}

fn exceeding_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: true,
        },
    }
}

fn mock_repo() -> MockReferralRepo {
    let mut repo = MockReferralRepo::new();
    repo.expect_get_referral_code_for_user().returning(|_| {
        Box::pin(async { Ok(referral_invitation::ReferralCode("TESTCODE".to_string())) })
    });
    repo
}

fn mock_discount_client() -> MockDiscountClient {
    MockDiscountClient::new()
}

fn build_service(
    rate_limiter: RateLimitServiceImpl<MockRateLimitPort>,
) -> ReferralServiceImpl<
    MockReferralRepo,
    MockDiscountClient,
    RateLimitServiceImpl<MockRateLimitPort>,
    MockNotificationIngress,
> {
    ReferralServiceImpl {
        repo: mock_repo(),
        discount_client: mock_discount_client(),
        rate_limit: rate_limiter,
        notification_ingress: MockNotificationIngress(MockNotificationIngressInner),
    }
}

fn test_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("test@example.com").unwrap()
}

fn test_recipient() -> EmailStr<'static> {
    EmailStr::try_from("recipient@example.com".to_string()).unwrap()
}

#[tokio::test]
async fn send_referral_invite_succeeds_when_under_rate_limit() {
    let service = build_service(allowing_rate_limiter());

    let result: Result<(), ReferralError> = service
        .send_referral_invite(test_user(), test_recipient())
        .await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn send_referral_invite_fails_when_rate_limit_exceeded() {
    let service = build_service(exceeding_rate_limiter());

    let result: Result<(), ReferralError> = service
        .send_referral_invite(test_user(), test_recipient())
        .await;

    assert!(result.is_err());
    assert!(
        matches!(result.unwrap_err(), ReferralError::RateLimitExceeded(_)),
        "expected RateLimitExceeded error"
    );
}

#[tokio::test]
async fn rate_limit_error_contains_exceeded_info() {
    let service = build_service(exceeding_rate_limiter());

    let err = service
        .send_referral_invite(test_user(), test_recipient())
        .await
        .unwrap_err();

    match err {
        ReferralError::RateLimitExceeded(exceeded) => {
            assert!(
                exceeded.current_count > exceeded.max_count,
                "current_count ({}) should exceed max_count ({})",
                exceeded.current_count,
                exceeded.max_count,
            );
        }
        other => panic!("expected RateLimitExceeded, got: {other:?}"),
    }
}

#[tokio::test]
async fn multiple_invites_succeed_when_under_rate_limit() {
    let service = build_service(allowing_rate_limiter());

    for i in 0..5 {
        let recipient = EmailStr::try_from(format!("recipient{i}@example.com")).unwrap();
        let result: Result<(), ReferralError> =
            service.send_referral_invite(test_user(), recipient).await;
        assert!(result.is_ok(), "invite {i} should succeed under rate limit");
    }
}
