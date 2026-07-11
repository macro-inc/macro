use std::ops::Deref;

use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use notification::domain::{
    models::SendNotificationRequest, service::NotificationIngress, service::SendNotificationError,
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

fn mock_repo() -> MockReferralRepo {
    let mut repo = MockReferralRepo::new();
    repo.expect_get_referral_code_for_user()
        .returning(|_| Box::pin(async { Ok(invite_email::ReferralCode("TESTCODE".to_string())) }));
    repo.expect_get_sender_info()
        .returning(|_| Box::pin(async { Ok((None, None)) }));
    repo
}

fn mock_discount_client() -> MockDiscountClient {
    MockDiscountClient::new()
}

fn build_service()
-> ReferralServiceImpl<MockReferralRepo, MockDiscountClient, MockNotificationIngress> {
    ReferralServiceImpl {
        repo: mock_repo(),
        discount_client: mock_discount_client(),
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
    let service = build_service();

    let result: Result<(), ReferralError> = service
        .send_referral_invite(test_user(), test_recipient())
        .await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn multiple_invites_succeed_when_under_rate_limit() {
    let service = build_service();

    for i in 0..5 {
        let recipient = EmailStr::try_from(format!("recipient{i}@example.com")).unwrap();
        let result: Result<(), ReferralError> =
            service.send_referral_invite(test_user(), recipient).await;
        assert!(result.is_ok(), "invite {i} should succeed under rate limit");
    }
}
