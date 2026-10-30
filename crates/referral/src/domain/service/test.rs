use std::ops::Deref;

use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use notification::domain::{
    models::SendNotificationRequest, service::NotificationIngress, service::SendNotificationError,
};
use rootcause::Report;

use crate::domain::{
    models::ReferralError,
    models::TrackedReferral,
    ports::{MockReferralRepo, MockReferralRewarder, ReferralService},
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

fn build_service()
-> ReferralServiceImpl<MockReferralRepo, MockReferralRewarder, MockNotificationIngress> {
    with_parts(mock_repo(), MockReferralRewarder::new())
}

fn with_parts(
    repo: MockReferralRepo,
    rewarder: MockReferralRewarder,
) -> ReferralServiceImpl<MockReferralRepo, MockReferralRewarder, MockNotificationIngress> {
    ReferralServiceImpl {
        repo,
        rewarder,
        notification_ingress: MockNotificationIngress(MockNotificationIngressInner),
    }
}

fn referred() -> macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'static>>
{
    macro_user_id::user_id::MacroUserId::parse_from_str("macro|new@example.com")
        .unwrap()
        .lowercase()
}

#[tokio::test]
async fn a_first_referral_rewards_the_referrer_and_completes() {
    let tracking_id = uuid::Uuid::from_u128(7);
    let mut repo = MockReferralRepo::new();
    repo.expect_track_referral()
        .times(1)
        .returning(move |_, _| {
            Box::pin(async move {
                Ok(Some(TrackedReferral {
                    tracking_id,
                    referrer: MacroUserIdStr::try_from_email("referrer@example.com").unwrap(),
                }))
            })
        });
    repo.expect_complete_referral()
        .times(1)
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let mut rewarder = MockReferralRewarder::new();
    rewarder
        .expect_reward_referrer()
        .withf(move |referrer, referred, key| {
            referrer.as_ref() == "macro|referrer@example.com"
                && referred.as_ref() == "macro|new@example.com"
                && key == &format!("referral:{tracking_id}")
        })
        .times(1)
        .returning(|_, _, _| Box::pin(async { Ok(()) }));
    let service = with_parts(repo, rewarder);

    service
        .track_referral(&referred(), &invite_email::ReferralCode("CODE".into()))
        .await
        .unwrap();
}

#[tokio::test]
async fn an_already_referred_user_rewards_nobody() {
    let mut repo = MockReferralRepo::new();
    repo.expect_track_referral()
        .returning(|_, _| Box::pin(async { Ok(None) }));
    let mut rewarder = MockReferralRewarder::new();
    rewarder.expect_reward_referrer().never();
    let service = with_parts(repo, rewarder);

    service
        .track_referral(&referred(), &invite_email::ReferralCode("CODE".into()))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_failed_reward_leaves_the_referral_incomplete() {
    let mut repo = MockReferralRepo::new();
    repo.expect_track_referral().returning(|_, _| {
        Box::pin(async {
            Ok(Some(TrackedReferral {
                tracking_id: uuid::Uuid::from_u128(8),
                referrer: MacroUserIdStr::try_from_email("referrer@example.com").unwrap(),
            }))
        })
    });
    repo.expect_complete_referral().never();
    let mut rewarder = MockReferralRewarder::new();
    rewarder
        .expect_reward_referrer()
        .returning(|_, _, _| Box::pin(async { Err(anyhow::anyhow!("billing down")) }));
    let service = with_parts(repo, rewarder);

    service
        .track_referral(&referred(), &invite_email::ReferralCode("CODE".into()))
        .await
        .unwrap();
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
