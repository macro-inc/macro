use onboarding::domain::models::OnboardingStatus;

use super::*;
use crate::test_support::{FakeAccounts, FakeOnboarding, onboarding_row, user};

fn accounts(
    existing: Option<onboarding::domain::models::OnboardingRow>,
    tutorial_complete: bool,
) -> HandoverSetupAccounts<FakeOnboarding, FakeAccounts> {
    let onboarding = Arc::new(FakeOnboarding {
        existing,
        ..FakeOnboarding::default()
    });
    HandoverSetupAccounts::new(
        onboarding.clone(),
        AgentHandover::new(
            onboarding,
            FakeAccounts::with_tutorial(&[Some(tutorial_complete)]),
        ),
    )
}

#[tokio::test]
async fn a_web_onboarded_account_reports_as_such() {
    let status = accounts(
        Some(onboarding_row(OnboardingStatus::Completed, false)),
        true,
    )
    .status(&user())
    .await
    .expect("status");

    assert_eq!(
        status,
        AccountStatus {
            agent_led: false,
            onboarded_on_web: true,
            new_account: false,
        }
    );
}

#[tokio::test]
async fn an_agent_led_account_is_not_counted_as_web_onboarded() {
    let status = accounts(
        Some(onboarding_row(OnboardingStatus::Completed, true)),
        true,
    )
    .status(&user())
    .await
    .expect("status");

    assert_eq!(
        status,
        AccountStatus {
            agent_led: true,
            onboarded_on_web: false,
            new_account: false,
        }
    );
}

#[tokio::test]
async fn handing_over_a_fresh_account_makes_it_agent_led() {
    let status = accounts(None, false)
        .hand_to_agent(&user())
        .await
        .expect("handover");

    assert!(status.agent_led);
}

#[tokio::test]
async fn a_fresh_account_counts_as_new_and_one_people_already_had_does_not() {
    let fresh = accounts(None, false).status(&user()).await.expect("status");
    assert!(fresh.new_account);

    let onboarding = Arc::new(FakeOnboarding::default());
    let existing = HandoverSetupAccounts::new(
        onboarding.clone(),
        AgentHandover::new(onboarding, FakeAccounts::existing(&[Some(false)], 30)),
    )
    .status(&user())
    .await
    .expect("status");
    assert!(!existing.new_account);
    assert!(!existing.agent_led);
}
