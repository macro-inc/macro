//! A purchase provisions at once and its charge settles in the billing
//! worker: success bills the computer, a refusal releases it, an unknown
//! outcome retries, and a team has one unpaid computer at a time.

use super::*;
use crate::domain::lifecycle::{Failure, SetupOutcome};
use crate::domain::service::billing::MAX_BILLING_ATTEMPTS;
use crate::domain::service::{ObservedItem, SubscriptionObserved, SubscriptionStatus};

#[tokio::test]
async fn purchase_provisions_at_once_and_charges_the_computer_and_the_seat_in_one_update() {
    let service = service_with(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
    );

    let purchase = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            purchase_key: key("buy-dialog-1"),
            team_id: TEAM,
            created_by: admin(),
            size: ComputerSize::Standard,
            name: Some("Ada".to_owned()),
            extra_items: vec![SubscriptionItem {
                price_id: stripe::PriceId::from_str("price_agent_seat").unwrap(),
                quantity: 1,
            }],
        })
        .await
        .unwrap();
    let Purchase::Ready(computer_id) = purchase else {
        panic!("expected a ready purchase, got {purchase:?}");
    };

    // Nothing was charged yet: creation and the charge run side by side.
    assert!(service.billing.adds.lock().unwrap().is_empty());
    assert!(service.repo.reservations.lock().unwrap().is_empty());
    assert_eq!(
        effects_of(&service.repo, computer_id),
        vec![
            Effect::Create {
                host: HOST,
                start: true,
                generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
            },
            Effect::Charge {
                price_id: stripe::PriceId::from_str("price_standard").unwrap(),
                extra_items: vec![SubscriptionItem {
                    price_id: stripe::PriceId::from_str("price_agent_seat").unwrap(),
                    quantity: 1,
                }],
            },
        ]
    );
    let status = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(status.name.as_str(), "Ada");
    assert_eq!(status.status, ComputerStatusKind::SettingUp);
    assert_eq!(status.billing, Some(BillingStatus::Purchasing));
    assert_eq!(
        status.setup,
        Some(crate::domain::models::SetupProgress {
            step: crate::domain::models::SetupStep::Creating,
            position: 2,
            total: 5,
            step_started_at: Some(now()),
        })
    );

    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    assert_eq!(
        *service.billing.adds.lock().unwrap(),
        vec![AddRequest {
            computer_id,
            price_id: stripe::PriceId::from_str("price_standard").unwrap(),
            extra_items: vec![SubscriptionItem {
                price_id: stripe::PriceId::from_str("price_agent_seat").unwrap(),
                quantity: 1,
            }],
            charge: ItemCharge::Prorated,
            key: format!("computer-add:{computer_id}"),
        }]
    );
    let stored = service
        .repo
        .get(computer_id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        stored.state.billing,
        BillingState::Active {
            subscription_item: item("si_1"),
        }
    );
    assert_eq!(stored.state.phase, Phase::Provisioning { start: true });
    assert_eq!(
        effects_of(&service.repo, computer_id),
        vec![Effect::Create {
            host: HOST,
            start: true,
            generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
        }]
    );
}

#[tokio::test]
async fn a_declined_charge_releases_the_computer_and_tells_the_buyer() {
    let service = service_with(
        FakeRepo {
            sold_units: 1,
            ..FakeRepo::default()
        },
        FakeBilling {
            decline: true,
            ..FakeBilling::default()
        },
    );
    let Purchase::Ready(computer_id) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a ready purchase");
    };

    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    let released = service
        .repo
        .get(computer_id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(released.state.phase, Phase::Destroying);
    assert_eq!(released.state.billing, BillingState::EndsAt { at: now() });
    assert!(service.billing.charges().is_empty());
    assert_eq!(
        effects_of(&service.repo, computer_id),
        vec![
            Effect::Create {
                host: HOST,
                start: true,
                generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
            },
            Effect::Destroy { host: HOST },
            Effect::RevokeHarness,
            Effect::NotifySetup {
                outcome: SetupOutcome::Failed {
                    failure: Failure::Payment,
                    failed_at: now(),
                },
            },
        ]
    );
    // Its only unit is free again, and nothing unpaid holds the team back.
    let again = service.purchase(standard_purchase("buy-dialog-2")).await;
    assert!(matches!(again, Ok(Purchase::Ready(_))), "{again:?}");
}

#[tokio::test]
async fn an_unknown_charge_outcome_retries_with_the_same_key_and_never_charges_twice() {
    let clock = MovingClock::new();
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            lose_response: AtomicBool::new(true),
            ..FakeBilling::default()
        },
        clock.clone(),
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let Purchase::Ready(computer_id) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a ready purchase");
    };

    service.run_billing_effects().await.unwrap();
    let charging = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(charging.billing, Some(BillingStatus::Purchasing));
    assert_eq!(charging.status, ComputerStatusKind::SettingUp);

    // Buying again from the same dialog answers with the same computer.
    let again = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    assert_eq!(again, Purchase::Ready(computer_id));
    assert_eq!(service.list(TEAM).await.unwrap().len(), 1);

    service.billing.lose_response.store(false, Ordering::SeqCst);
    clock.advance(chrono::Duration::seconds(30));
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    assert_eq!(
        service.billing.charges(),
        vec![format!("computer-add:{computer_id}")]
    );
    assert_eq!(
        service
            .billing
            .adds
            .lock()
            .unwrap()
            .iter()
            .map(|add| add.key.clone())
            .collect::<Vec<_>>(),
        vec![
            format!("computer-add:{computer_id}"),
            format!("computer-add:{computer_id}"),
        ]
    );
    assert_eq!(
        service.status(TEAM, computer_id).await.unwrap().billing,
        Some(BillingStatus::Active)
    );
}

#[tokio::test]
async fn a_charge_still_unknown_at_its_last_attempt_is_settled_for_good() {
    for (landed, billing) in [
        (
            true,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
        (false, BillingState::EndsAt { at: now() }),
    ] {
        let clock = MovingClock::new();
        let service = ComputerService::new(
            FakeRepo {
                sold_units: 9,
                ..FakeRepo::default()
            },
            FakeBilling {
                lose_response: AtomicBool::new(landed),
                provider_error: AtomicBool::new(!landed),
                ..FakeBilling::default()
            },
            clock.clone(),
            StaticFleetAttachment(FleetAttachment::Attached),
        );
        let Purchase::Ready(computer_id) = service
            .purchase(standard_purchase("buy-dialog-1"))
            .await
            .unwrap()
        else {
            panic!("expected a ready purchase");
        };

        for _ in 0..MAX_BILLING_ATTEMPTS {
            service.run_billing_effects().await.unwrap();
            clock.advance(chrono::Duration::hours(1));
        }

        let settled = service
            .repo
            .get(computer_id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap();
        let at = now() + chrono::Duration::hours(i64::from(MAX_BILLING_ATTEMPTS) - 1);
        let expected = match billing {
            BillingState::EndsAt { .. } => BillingState::EndsAt { at },
            other => other,
        };
        assert_eq!(settled.state.billing, expected, "landed: {landed}");
        assert_eq!(
            *service.billing.settled.lock().unwrap(),
            vec![format!("computer-add:{computer_id}")],
            "landed: {landed}"
        );
        assert_eq!(
            usize::try_from(MAX_BILLING_ATTEMPTS).unwrap() - 1,
            service.billing.adds.lock().unwrap().len(),
            "landed: {landed}"
        );
        assert_eq!(
            settled.state.phase == Phase::Destroying,
            !landed,
            "landed: {landed}"
        );
    }
}

#[tokio::test]
async fn a_team_buys_its_next_computer_once_the_last_one_is_paid_for() {
    let service = service_with(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
    );
    service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();

    let second = service.purchase(standard_purchase("buy-dialog-2")).await;
    assert!(
        matches!(second, Err(ComputerError::UnpaidComputer)),
        "{second:?}"
    );
    assert_eq!(service.list(TEAM).await.unwrap().len(), 1);

    service.run_billing_effects().await.unwrap();
    let second = service.purchase(standard_purchase("buy-dialog-2")).await;
    assert!(matches!(second, Ok(Purchase::Ready(_))), "{second:?}");
    assert_eq!(service.list(TEAM).await.unwrap().len(), 2);
}

#[tokio::test]
async fn a_charging_computer_cannot_be_canceled_but_releasing_it_fences_its_charge() {
    let service = service_with(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
    );
    let Purchase::Ready(computer_id) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a ready purchase");
    };

    assert!(matches!(
        service.cancel(TEAM, computer_id).await,
        Err(ComputerError::Rejected(
            crate::domain::lifecycle::Rejected::PaymentPending
        ))
    ));
    let name = service.status(TEAM, computer_id).await.unwrap().name;
    let released = service.release_now(TEAM, computer_id, &name).await.unwrap();
    assert_eq!(released.status, ComputerStatusKind::Released);

    service.run_billing_effects().await.unwrap();

    assert!(service.billing.adds.lock().unwrap().is_empty());
    assert_eq!(
        *service.billing.settled.lock().unwrap(),
        vec![format!("computer-add:{computer_id}")]
    );
    assert!(service.billing.removals.lock().unwrap().is_empty());
}

/// A subscription snapshot read while a charge settles must not strip the
/// item the charge just added, nor bill the computer on it: the charge decides.
#[tokio::test]
async fn a_subscription_snapshot_leaves_a_charging_computer_to_its_charge() {
    let service = service_with(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
    );
    let Purchase::Ready(computer_id) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a ready purchase");
    };

    service
        .observe_subscription(
            TEAM,
            SubscriptionObserved {
                status: SubscriptionStatus::Active,
                items: vec![ObservedItem {
                    subscription_item: item("si_landed"),
                    computer_id: Some(computer_id),
                }],
                current_period_end: now() + chrono::Duration::days(20),
                observed_at: now(),
            },
        )
        .await
        .unwrap();

    assert!(service.billing.removals.lock().unwrap().is_empty());
    let stored = service
        .repo
        .get(computer_id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(stored.state.billing, BillingState::Charging);
}

/// A purchase whose conversion never happened (the request dropped after
/// reserving) is converted by the confirm worker and charged like any other.
#[tokio::test]
async fn the_confirm_worker_converts_a_reservation_the_purchase_left_behind() {
    let clock = MovingClock::new();
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        clock.clone(),
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let Ok(crate::domain::models::Reserved::New(reservation)) = service
        .repo
        .reserve(
            crate::domain::models::NewReservation {
                id: ComputerId::new_from_uuid(Uuid::from_u128(7)),
                team_id: TEAM,
                purchase_key: key("buy-dialog-1"),
                name: ComputerName::try_new("Ada").unwrap(),
                size: ComputerSize::Standard,
                resources: crate::domain::size::ComputerResources {
                    vcpus: crate::domain::size::Vcpus::new(4),
                    memory_gib: crate::domain::size::MemoryGib::new(8),
                    disk_gib: crate::domain::size::DiskGib::new(100),
                },
                catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                    "standard@2026-11".to_owned(),
                )
                .unwrap(),
                funding: Funding::Stripe {
                    price_id: stripe::PriceId::from_str("price_standard").unwrap(),
                },
                created_by: admin(),
                extra_items: vec![],
                provision_traceparent: None,
                agent: None,
            },
            now(),
            now() + RESERVATION_TTL,
        )
        .await
    else {
        panic!("expected a new reservation");
    };
    assert_eq!(
        service.status(TEAM, reservation.id).await.unwrap().status,
        ComputerStatusKind::Purchasing
    );

    clock.advance(CONFIRM_DELAY);
    // The confirm pass converts it; the same pass's charge waits for the next.
    service.run_billing_effects().await.unwrap();
    service.run_billing_effects().await.unwrap();

    assert!(service.repo.reservations.lock().unwrap().is_empty());
    assert_eq!(
        service.status(TEAM, reservation.id).await.unwrap().billing,
        Some(BillingStatus::Active)
    );
    assert_eq!(
        service.billing.charges(),
        vec![format!("computer-add:{}", reservation.id)]
    );
}
