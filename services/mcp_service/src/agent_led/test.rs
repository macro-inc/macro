use onboarding::domain::models::OnboardingStatus;

use super::*;
use crate::test_support::{FakeAccounts, FakeOnboarding, onboarding_row as row, user};

fn handover(
    onboarding: FakeOnboarding,
    accounts: FakeAccounts,
) -> (
    AgentHandover<FakeOnboarding, FakeAccounts>,
    Arc<FakeOnboarding>,
) {
    let onboarding = Arc::new(onboarding);
    (AgentHandover::new(onboarding.clone(), accounts), onboarding)
}

#[tokio::test]
async fn a_new_account_is_handed_to_the_agent_and_skips_web_onboarding() {
    let accounts = FakeAccounts::with_tutorial(&[Some(false)]);
    let (handover, onboarding) = handover(FakeOnboarding::default(), accounts.clone());

    let outcome = handover
        .hand_over(&user(), Some("claude-code"))
        .await
        .expect("handover");

    assert_eq!(outcome, Handover::AgentLed);
    assert_eq!(
        onboarding.markings.lock().unwrap().as_slice(),
        &[Some("claude-code".to_string())]
    );
    assert_eq!(*accounts.completed.lock().unwrap(), 1);
}

#[tokio::test]
async fn a_web_onboarded_account_is_left_alone() {
    let accounts = FakeAccounts::with_tutorial(&[Some(true)]);
    let (handover, onboarding) = handover(
        FakeOnboarding {
            existing: Some(row(OnboardingStatus::Completed, false)),
            ..FakeOnboarding::default()
        },
        accounts.clone(),
    );

    let outcome = handover
        .hand_over(&user(), Some("codex"))
        .await
        .expect("handover");

    assert_eq!(outcome, Handover::WebOnboarded);
    assert!(onboarding.markings.lock().unwrap().is_empty());
    assert_eq!(*accounts.completed.lock().unwrap(), 0);
}

#[tokio::test]
async fn an_account_already_agent_led_needs_nothing_more() {
    let accounts = FakeAccounts::with_tutorial(&[Some(true)]);
    let (handover, onboarding) = handover(
        FakeOnboarding {
            existing: Some(row(OnboardingStatus::Completed, true)),
            ..FakeOnboarding::default()
        },
        accounts.clone(),
    );

    let outcome = handover
        .hand_over(&user(), Some("codex"))
        .await
        .expect("handover");

    assert_eq!(outcome, Handover::AgentLed);
    assert!(onboarding.markings.lock().unwrap().is_empty());
    assert_eq!(*accounts.completed.lock().unwrap(), 0);
}

#[tokio::test]
async fn a_completed_web_row_is_not_overridden_even_if_the_tutorial_bit_lags() {
    // The onboarding row is the source of truth for the newer flow; the
    // repository refuses to mark a completed web row, so the tutorial bit is
    // left alone too.
    let accounts = FakeAccounts::with_tutorial(&[Some(false)]);
    let (handover, _) = handover(
        FakeOnboarding {
            existing: Some(row(OnboardingStatus::Completed, false)),
            ..FakeOnboarding::default()
        },
        accounts.clone(),
    );

    let outcome = handover.hand_over(&user(), None).await.expect("handover");

    assert_eq!(outcome, Handover::WebOnboarded);
    assert_eq!(*accounts.completed.lock().unwrap(), 0);
}

#[tokio::test]
async fn waits_for_the_account_row_a_fresh_sign_in_creates() {
    let accounts = FakeAccounts::with_tutorial(&[None, None, Some(false)]);
    let (handover, _) = handover(FakeOnboarding::default(), accounts.clone());

    let outcome = handover
        .hand_over(&user(), Some("claude-ai"))
        .await
        .expect("handover");

    assert_eq!(outcome, Handover::AgentLed);
}

#[tokio::test]
async fn gives_up_when_the_account_row_never_appears() {
    let accounts = FakeAccounts::with_tutorial(&[None]);
    let (handover, onboarding) = handover(FakeOnboarding::default(), accounts);
    let handover = handover.without_retry_delays();

    let outcome = handover.hand_over(&user(), Some("claude-ai")).await;

    assert!(outcome.is_err());
    assert!(onboarding.markings.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_sign_in_hands_over_only_the_account_it_created() {
    let accounts = FakeAccounts::with_tutorial(&[Some(false)]);
    let (handover, onboarding) = handover(FakeOnboarding::default(), accounts.clone());

    let outcome = handover
        .hand_over_new_sign_up(&user(), Some("claude-ai"), chrono::Utc::now())
        .await
        .expect("handover");

    assert_eq!(outcome, Handover::AgentLed);
    assert_eq!(onboarding.markings.lock().unwrap().len(), 1);
    assert_eq!(*accounts.completed.lock().unwrap(), 1);
}

#[tokio::test]
async fn a_sign_in_leaves_an_account_people_already_had_alone() {
    // Never finished web onboarding, but has had Macro for a month: their
    // agent sets it up only when they ask.
    for accounts in [
        FakeAccounts::existing(&[Some(false)], 30),
        FakeAccounts {
            created_at: None,
            ..FakeAccounts::with_tutorial(&[Some(false)])
        },
    ] {
        let (handover, onboarding) = handover(FakeOnboarding::default(), accounts.clone());

        let outcome = handover
            .hand_over_new_sign_up(&user(), Some("chatgpt"), chrono::Utc::now())
            .await
            .expect("handover");

        assert_eq!(outcome, Handover::Existing);
        assert!(onboarding.markings.lock().unwrap().is_empty());
        assert_eq!(*accounts.completed.lock().unwrap(), 0);
    }
}

#[tokio::test]
async fn an_agent_led_account_stays_agent_led_on_later_sign_ins() {
    let accounts = FakeAccounts::existing(&[Some(true)], 3);
    let (handover, _) = handover(
        FakeOnboarding {
            existing: Some(row(OnboardingStatus::Completed, true)),
            ..FakeOnboarding::default()
        },
        accounts,
    );

    let outcome = handover
        .hand_over_new_sign_up(&user(), Some("codex"), chrono::Utc::now())
        .await
        .expect("handover");

    assert_eq!(outcome, Handover::AgentLed);
}

#[tokio::test]
async fn a_handover_interrupted_before_the_tutorial_is_finished_on_retry() {
    // Marked agent-led, but the tutorial write never landed.
    let accounts = FakeAccounts::with_tutorial(&[Some(false)]);
    let (handover, onboarding) = handover(
        FakeOnboarding {
            existing: Some(row(OnboardingStatus::Completed, true)),
            ..FakeOnboarding::default()
        },
        accounts.clone(),
    );

    let outcome = handover.hand_over(&user(), None).await.expect("handover");

    assert_eq!(outcome, Handover::AgentLed);
    assert!(onboarding.markings.lock().unwrap().is_empty());
    assert_eq!(*accounts.completed.lock().unwrap(), 1);
}
