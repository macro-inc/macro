//! A computer released after failing its first start twice gets its purchase
//! refunded before its item comes off the subscription.

use super::*;
use crate::domain::lifecycle::{Event, Failure, PurchaseRefund};
use crate::domain::setup::SetupTimeline;

const COMPUTER: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(1));

/// A billed computer that failed its first start twice, as the operator
/// leaves it: released, with its refund queued.
async fn failed_twice(
    billing: FakeBilling,
) -> ComputerService<FakeRepo, FakeBilling, FixedClock, StaticFleetAttachment> {
    let repo = FakeRepo::default();
    let mut setting_up = computer(
        COMPUTER,
        Phase::Booting,
        BillingState::Active {
            subscription_item: item("si_1"),
        },
    );
    setting_up.state.setup = Some(SetupTimeline::started(now()));
    repo.computers.lock().unwrap().insert(COMPUTER, setting_up);
    billing.items.lock().unwrap().push((item("si_1"), COMPUTER));
    let service = service_with(repo, billing);
    let refused = Event::EffectFailed {
        failure: Failure::Create,
        reason: "create refused".to_owned(),
    };
    for event in [refused.clone(), Event::TeamRetry, refused] {
        service.repo.apply(COMPUTER, event, now()).await.unwrap();
    }
    assert!(
        effects_of(&service.repo, COMPUTER)
            .iter()
            .any(|effect| matches!(effect, Effect::RefundPurchase { .. }))
    );
    service
}

fn state(
    service: &ComputerService<FakeRepo, FakeBilling, FixedClock, StaticFleetAttachment>,
) -> ComputerState {
    service.repo.computers.lock().unwrap()[&COMPUTER]
        .state
        .clone()
}

#[tokio::test]
async fn the_refund_lands_before_the_item_comes_off_and_is_recorded() {
    let service = failed_twice(FakeBilling::default()).await;

    service.run_billing_effects().await.unwrap();

    assert_eq!(
        *service.billing.refunds.lock().unwrap(),
        vec![(COMPUTER, format!("computer-refund:{COMPUTER}"))]
    );
    let calls = service.billing.calls.lock().unwrap().clone();
    let refunded = calls
        .iter()
        .position(|call| *call == "refund_computer_purchase")
        .unwrap();
    let removed = calls
        .iter()
        .position(|call| *call == "remove_computer")
        .unwrap();
    assert!(refunded < removed);
    assert!(service.billing.items.lock().unwrap().is_empty());
    assert_eq!(
        state(&service).refund,
        Some(PurchaseRefund {
            credit_note: "cn_1".parse().unwrap(),
            refund: Some("re_1".parse().unwrap()),
        })
    );
    assert!(
        !effects_of(&service.repo, COMPUTER)
            .iter()
            .any(|effect| matches!(effect, Effect::RefundPurchase { .. }))
    );
}

#[tokio::test]
async fn a_failed_refund_keeps_the_item_and_retries_under_the_same_key() {
    let billing = FakeBilling::default();
    billing.refund_fails.store(true, Ordering::SeqCst);
    let service = failed_twice(billing).await;

    service.run_billing_effects().await.unwrap();

    assert_eq!(service.billing.items.lock().unwrap().len(), 1);
    assert!(service.billing.removals.lock().unwrap().is_empty());
    assert!(
        effects_of(&service.repo, COMPUTER)
            .iter()
            .any(|effect| matches!(effect, Effect::RefundPurchase { .. }))
    );
}

#[tokio::test]
async fn nothing_paid_means_nothing_refunded_but_the_item_still_comes_off() {
    let service = failed_twice(FakeBilling {
        nothing_to_refund: true,
        ..FakeBilling::default()
    })
    .await;

    service.run_billing_effects().await.unwrap();

    assert!(service.billing.items.lock().unwrap().is_empty());
    assert_eq!(state(&service).refund, None);
}

#[tokio::test]
async fn an_agent_coming_online_completes_its_computers_setup() {
    let repo = FakeRepo::default();
    let mut starting = computer(
        COMPUTER,
        Phase::Running,
        BillingState::Active {
            subscription_item: item("si_1"),
        },
    );
    starting.state.awaiting_agent = true;
    repo.computers.lock().unwrap().insert(COMPUTER, starting);
    let service = service_with(repo, FakeBilling::default());

    service.agent_online(TEAM, COMPUTER).await.unwrap();

    let computers = service.repo.computers.lock().unwrap();
    assert!(!computers[&COMPUTER].state.awaiting_agent);
    assert_eq!(computers[&COMPUTER].setup_completed_at, Some(now()));
}

#[tokio::test]
async fn an_agent_online_again_keeps_the_first_setup_time() {
    let repo = FakeRepo::default();
    let earlier = now() - chrono::Duration::hours(1);
    let mut set_up = computer(
        COMPUTER,
        Phase::Running,
        BillingState::Active {
            subscription_item: item("si_1"),
        },
    );
    set_up.setup_completed_at = Some(earlier);
    repo.computers.lock().unwrap().insert(COMPUTER, set_up);
    let service = service_with(repo, FakeBilling::default());

    service.agent_online(TEAM, COMPUTER).await.unwrap();

    assert_eq!(
        service.repo.computers.lock().unwrap()[&COMPUTER].setup_completed_at,
        Some(earlier)
    );
}
