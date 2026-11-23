//! A charged purchase answers once its charge has an outcome, with the
//! computer already provisioning: 200 when charged, 402 when refused (the
//! computer released and never listed), 202 when unknown, which the
//! billing worker settles.

use super::*;
use crate::domain::lifecycle::{Charger, Event, Failure, LandedCharge, Rejected, SetupOutcome};
use crate::domain::service::Clock as _;
use crate::domain::service::billing::{CHANGE_IN_FLIGHT_RETRY, MAX_BILLING_ATTEMPTS};
use crate::domain::setup::SetupTimeline;

const COMPUTER: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(1));

type Clock = std::sync::Arc<MovingClock>;
type Service = ComputerService<FakeRepo, FakeBilling, Clock, StaticFleetAttachment>;

fn charging(charger: Charger) -> BillingState {
    BillingState::Charging {
        extra_items: vec![],
        charger,
    }
}

fn moving_service(repo: FakeRepo, billing: FakeBilling) -> (Service, Clock) {
    let clock = MovingClock::new();
    (
        ComputerService::new(
            repo,
            billing,
            clock.clone(),
            StaticFleetAttachment(FleetAttachment::Attached),
        ),
        clock,
    )
}

fn billing_of(service: &Service, computer_id: ComputerId) -> BillingState {
    service.repo.computers.lock().unwrap()[&computer_id]
        .state
        .billing
        .clone()
}

/// Run the billing worker until it has nothing due, an hour apart so every
/// backoff has passed.
async fn drain_billing(service: &Service, clock: &Clock) {
    for _ in 0..=MAX_BILLING_ATTEMPTS {
        clock.advance(chrono::Duration::hours(1));
        service.run_billing_effects().await.unwrap();
    }
}

/// A computer setting up whose purchase request left its charge to
/// `charger`, as a purchase leaves it.
fn repo_with_charging(charger: Charger) -> FakeRepo {
    let repo = FakeRepo {
        sold_units: 9,
        ..FakeRepo::default()
    };
    let mut bought = computer(COMPUTER, Phase::Booting, charging(charger));
    bought.state.setup = Some(SetupTimeline::started(now()));
    bought.enrolled_at = None;
    repo.computers.lock().unwrap().insert(COMPUTER, bought);
    repo
}

#[tokio::test]
async fn an_unknown_outcome_answers_confirming_and_a_later_decline_tells_the_buyer() {
    let (service, clock) = moving_service(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            provider_error: AtomicBool::new(true),
            ..FakeBilling::default()
        },
    );

    let purchase = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    let Purchase::Confirming(computer_id) = purchase else {
        panic!("expected a confirming purchase, got {purchase:?}");
    };
    assert_eq!(billing_of(&service, computer_id), charging(Charger::Worker));
    assert_eq!(service.list(TEAM).await.unwrap().len(), 1);

    // The worker's replay is refused.
    service
        .billing
        .provider_error
        .store(false, Ordering::SeqCst);
    service.billing.decline.store(true, Ordering::SeqCst);
    clock.advance(CONFIRM_DELAY);
    service.run_billing_effects().await.unwrap();

    let effects = effects_of(&service.repo, computer_id);
    assert!(
        effects.ends_with(&[
            Effect::Destroy { host: HOST },
            Effect::RevokeHarness,
            Effect::UndoAgentInvite,
            Effect::NotifySetup {
                outcome: SetupOutcome::Failed {
                    failure: Failure::Payment,
                    failed_at: clock.now(),
                },
            },
        ]),
        "{effects:?}"
    );
    assert!(service.list(TEAM).await.unwrap().is_empty());
    assert!(service.billing.charges().is_empty());
    assert_eq!(
        service
            .billing
            .adds
            .lock()
            .unwrap()
            .iter()
            .map(|add| add.key.clone())
            .collect::<Vec<_>>(),
        vec![format!("computer-add:{computer_id}"); 2]
    );
}

#[tokio::test]
async fn an_unknown_outcome_that_landed_settles_as_charged_on_the_last_attempt() {
    let (service, clock) = moving_service(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            lose_response: AtomicBool::new(true),
            ..FakeBilling::default()
        },
    );
    let Purchase::Confirming(computer_id) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a confirming purchase");
    };

    drain_billing(&service, &clock).await;

    assert_eq!(
        billing_of(&service, computer_id),
        BillingState::Active {
            subscription_item: item("si_1"),
        }
    );
    assert_eq!(
        *service.billing.settled.lock().unwrap(),
        vec![format!("computer-add:{computer_id}")]
    );
    assert_eq!(
        service.billing.charges(),
        vec![format!("computer-add:{computer_id}")]
    );
}

#[tokio::test]
async fn a_request_that_never_answered_is_taken_over_by_the_billing_worker() {
    let (service, clock) =
        moving_service(repo_with_charging(Charger::Request), FakeBilling::default());

    // The takeover timer fires CHARGE_TAKEOVER after the purchase.
    service
        .repo
        .apply(
            COMPUTER,
            crate::domain::lifecycle::TimerKind::ChargeUnsettled.event(None),
            clock.now(),
        )
        .await
        .unwrap();
    service.run_billing_effects().await.unwrap();

    assert_eq!(
        billing_of(&service, COMPUTER),
        BillingState::Active {
            subscription_item: item("si_1"),
        }
    );
    assert_eq!(
        *service.billing.adds.lock().unwrap(),
        vec![AddRequest {
            computer_id: COMPUTER,
            price_id: stripe::PriceId::from_str("price_standard").unwrap(),
            extra_items: vec![],
            charge: ItemCharge::Prorated,
            key: format!("computer-add:{COMPUTER}"),
        }]
    );
}

#[tokio::test]
async fn billing_requests_on_a_charging_computer_wait_for_its_payment() {
    let (service, _clock) =
        moving_service(repo_with_charging(Charger::Request), FakeBilling::default());

    for result in [
        service.cancel(TEAM, COMPUTER).await,
        service.undo_cancel(TEAM, COMPUTER).await,
        service.restore(TEAM, COMPUTER).await,
    ] {
        assert!(
            matches!(
                result,
                Err(ComputerError::Rejected(Rejected::PaymentPending))
            ),
            "{result:?}"
        );
    }
    assert!(service.billing.adds.lock().unwrap().is_empty());
}

#[tokio::test]
async fn releasing_a_charging_computer_takes_back_an_item_that_landed() {
    let (service, clock) =
        moving_service(repo_with_charging(Charger::Request), FakeBilling::default());
    // The request's charge landed while the release ran.
    service
        .billing
        .items
        .lock()
        .unwrap()
        .push((item("si_9"), COMPUTER));

    service
        .release_now(TEAM, COMPUTER, "Build box")
        .await
        .unwrap();
    assert!(
        effects_of(&service.repo, COMPUTER).contains(&Effect::SettleCharge {
            landed: LandedCharge::Remove,
        })
    );
    drain_billing(&service, &clock).await;

    assert_eq!(
        *service.billing.settled.lock().unwrap(),
        vec![format!("computer-add:{COMPUTER}")]
    );
    assert!(service.billing.items.lock().unwrap().is_empty());
    assert!(service.billing.refunds.lock().unwrap().is_empty());
    assert!(service.list(TEAM).await.unwrap().is_empty());
}

#[tokio::test]
async fn releasing_a_charging_computer_whose_charge_never_landed_bills_nothing() {
    let (service, clock) =
        moving_service(repo_with_charging(Charger::Worker), FakeBilling::default());

    service
        .release_now(TEAM, COMPUTER, "Build box")
        .await
        .unwrap();
    drain_billing(&service, &clock).await;

    assert_eq!(
        *service.billing.settled.lock().unwrap(),
        vec![format!("computer-add:{COMPUTER}")]
    );
    assert!(service.billing.adds.lock().unwrap().is_empty());
    assert!(service.billing.removals.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_second_failed_first_start_while_charging_refunds_a_landed_charge() {
    let (service, clock) =
        moving_service(repo_with_charging(Charger::Request), FakeBilling::default());
    service
        .billing
        .items
        .lock()
        .unwrap()
        .push((item("si_9"), COMPUTER));
    let refused = Event::EffectFailed {
        failure: Failure::Create,
        reason: "create refused".to_owned(),
    };
    for event in [refused.clone(), Event::TeamRetry, refused] {
        service
            .repo
            .apply(COMPUTER, event, clock.now())
            .await
            .unwrap();
    }
    let effects = effects_of(&service.repo, COMPUTER);
    assert!(
        effects.contains(&Effect::SettleCharge {
            landed: LandedCharge::Refund,
        }),
        "{effects:?}"
    );

    drain_billing(&service, &clock).await;

    assert_eq!(
        *service.billing.refunds.lock().unwrap(),
        vec![(COMPUTER, format!("computer-refund:{COMPUTER}"))]
    );
    assert!(service.billing.items.lock().unwrap().is_empty());
    assert!(
        service.repo.computers.lock().unwrap()[&COMPUTER]
            .state
            .refund
            .is_some()
    );
}

#[tokio::test]
async fn an_agent_purchase_refused_by_the_card_answers_payment_failed() {
    let (service, _clock) = moving_service(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            decline: AtomicBool::new(true),
            ..FakeBilling::default()
        },
    );

    let service = service.with_rollout(super::rollout::enabled_rollout());
    let result = service
        .purchase_for_agent(
            standard_purchase("invite-1"),
            MacroUserIdStr::try_from("macro|agent@example.com".to_owned()).unwrap(),
        )
        .await;

    assert!(
        matches!(
            result,
            Err(ComputerError::Billing(BillingError::PaymentFailed))
        ),
        "{result:?}"
    );
    let computers = service.repo.computers.lock().unwrap();
    let [declined] = computers.values().collect::<Vec<_>>()[..] else {
        panic!("expected one released computer");
    };
    assert!(declined.state.declined());
    assert!(!declined.state.awaiting_agent);
    drop(computers);
    // Its caller undoes the invite on the 402: the lifecycle queues nothing
    // for it, and no agent credentials were ever handed out.
    let effects = effects_of(&service.repo, declined_id(&service));
    assert!(
        !effects
            .iter()
            .any(|effect| matches!(effect, Effect::UndoAgentInvite | Effect::DeliverAgent)),
        "{effects:?}"
    );
}

fn declined_id(service: &Service) -> ComputerId {
    *service
        .repo
        .computers
        .lock()
        .unwrap()
        .keys()
        .next()
        .unwrap()
}

/// A purchase right after a release on the same subscription: the release's
/// item removal is still in flight, so the charge is refused for now. It is
/// tried again within seconds, not after the billing backoff, and spends no
/// attempt.
#[tokio::test]
async fn a_charge_behind_another_subscription_change_is_retried_within_seconds() {
    let (service, clock) = moving_service(
        repo_with_charging(Charger::Request),
        FakeBilling {
            change_in_flight: AtomicBool::new(true),
            ..FakeBilling::default()
        },
    );
    service
        .repo
        .apply(
            COMPUTER,
            crate::domain::lifecycle::TimerKind::ChargeUnsettled.event(None),
            clock.now(),
        )
        .await
        .unwrap();

    service.run_billing_effects().await.unwrap();

    let charge = service
        .repo
        .effects
        .lock()
        .unwrap()
        .iter()
        .find(|pending| pending.effect == Effect::Charge)
        .map(|pending| (pending.id, pending.attempts))
        .unwrap();
    assert_eq!(charge.1, 0, "waiting on another change spends no attempt");
    assert_eq!(
        service.repo.effect_run_after.lock().unwrap()[&charge.0],
        clock.now() + CHANGE_IN_FLIGHT_RETRY
    );

    service
        .billing
        .change_in_flight
        .store(false, Ordering::SeqCst);
    clock.advance(CHANGE_IN_FLIGHT_RETRY);
    service.run_billing_effects().await.unwrap();

    assert_eq!(
        billing_of(&service, COMPUTER),
        BillingState::Active {
            subscription_item: item("si_1"),
        }
    );
}
