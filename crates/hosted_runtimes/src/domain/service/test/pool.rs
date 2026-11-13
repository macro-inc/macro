use super::*;
use crate::domain::service::billing::MAX_BILLING_ATTEMPTS;

const POOLED: ComputerId =
    ComputerId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0b0b));

/// A host with sold room for two standard computers, holding one booted,
/// connected pool computer.
fn repo_with_pool() -> FakeRepo {
    let repo = FakeRepo {
        sold_units: 2,
        ..FakeRepo::default()
    };
    let mut pooled = computer(POOLED, Phase::Running, BillingState::Pool);
    pooled.state.macrod_connected = true;
    pooled.enrolled_at = None;
    repo.computers.lock().unwrap().insert(POOLED, pooled);
    repo
}

#[tokio::test]
async fn a_purchase_takes_a_pool_computer_and_charges_it_after_returning() {
    let service = service_with(repo_with_pool(), FakeBilling::default());

    let purchase = service
        .purchase(PurchaseRequest {
            name: Some("Ada".to_owned()),
            extra_items: vec![SubscriptionItem {
                price_id: stripe::PriceId::from_str("price_agent_seat").unwrap(),
                quantity: 1,
            }],
            ..standard_purchase("buy-dialog-1")
        })
        .await
        .unwrap();

    assert_eq!(purchase, Purchase::Ready(POOLED));
    // Nothing reached billing before the purchase returned.
    assert_eq!(*service.billing.adds.lock().unwrap(), vec![]);
    let taken = service
        .repo
        .get(POOLED)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        taken.owner,
        Some(crate::domain::models::Ownership {
            team_id: TEAM,
            created_by: admin(),
            funding: Funding::Stripe {
                price_id: stripe::PriceId::from_str("price_standard").unwrap(),
            },
        })
    );
    assert_eq!(taken.name.as_str(), "Ada");
    assert_eq!(taken.state.billing, BillingState::Charging);
    assert_eq!(taken.state.phase, Phase::Running);
    let status = taken.status(0, now(), policy());
    assert_eq!(status.status, ComputerStatusKind::Ready);
    assert_eq!(status.setup, None);
    assert_eq!(status.billing, Some(BillingStatus::Purchasing));
    assert_eq!(
        effects_of(&service.repo, POOLED),
        vec![
            Effect::Charge {
                price_id: stripe::PriceId::from_str("price_standard").unwrap(),
                extra_items: vec![SubscriptionItem {
                    price_id: stripe::PriceId::from_str("price_agent_seat").unwrap(),
                    quantity: 1,
                }],
            },
            Effect::JoinTeam,
        ]
    );

    service.run_billing_effects().await.unwrap();

    assert_eq!(
        *service.billing.adds.lock().unwrap(),
        vec![AddRequest {
            computer_id: POOLED,
            price_id: stripe::PriceId::from_str("price_standard").unwrap(),
            extra_items: vec![SubscriptionItem {
                price_id: stripe::PriceId::from_str("price_agent_seat").unwrap(),
                quantity: 1,
            }],
            charge: ItemCharge::Prorated,
            key: format!("computer-add:{POOLED}"),
        }]
    );
    assert_eq!(
        service
            .repo
            .get(POOLED)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .billing,
        BillingState::Active {
            subscription_item: item("si_1")
        }
    );
    assert_eq!(effects_of(&service.repo, POOLED), vec![Effect::JoinTeam]);
}

#[tokio::test]
async fn a_retried_purchase_returns_the_pool_computer_it_took() {
    let service = service_with(repo_with_pool(), FakeBilling::default());

    let first = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    let retried = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();

    assert_eq!(first, Purchase::Ready(POOLED));
    assert_eq!(retried, Purchase::Ready(POOLED));
    assert_eq!(*service.repo.reserve_calls.lock().unwrap(), 1);
    assert!(service.repo.reservations.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_refused_charge_releases_the_computer_it_took() {
    let service = service_with(
        repo_with_pool(),
        FakeBilling {
            decline: true,
            ..FakeBilling::default()
        },
    );

    service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    service.run_billing_effects().await.unwrap();

    let released = service
        .repo
        .get(POOLED)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(released.state.phase, Phase::Destroying);
    assert_eq!(released.state.billing, BillingState::EndsAt { at: now() });
    assert_eq!(
        effects_of(&service.repo, POOLED),
        vec![
            Effect::JoinTeam,
            Effect::Destroy { host: HOST },
            Effect::RevokeHarness,
        ]
    );
    assert!(service.list(TEAM).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_charge_whose_outcome_stays_unknown_settles_on_its_last_attempt() {
    let cases = [
        // The add reached the subscription but its answers were lost.
        ("charged", true, Phase::Running),
        // It never reached the subscription.
        ("not charged", false, Phase::Destroying),
    ];
    for (case, charged, phase) in cases {
        let billing = FakeBilling::default();
        billing.provider_error.store(true, Ordering::SeqCst);
        let service = service_with(repo_with_pool(), billing);
        service
            .purchase(standard_purchase("buy-dialog-1"))
            .await
            .unwrap();
        for pending in service.repo.effects.lock().unwrap().iter_mut() {
            pending.attempts = MAX_BILLING_ATTEMPTS - 1;
        }
        if charged {
            service
                .billing
                .items
                .lock()
                .unwrap()
                .push((item("si_lost"), POOLED));
        }

        service.run_billing_effects().await.unwrap();

        let computer = service
            .repo
            .get(POOLED)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap();
        assert_eq!(
            *service.billing.settled.lock().unwrap(),
            vec![format!("computer-add:{POOLED}")],
            "{case}"
        );
        assert_eq!(computer.state.phase, phase, "{case}");
        if charged {
            assert_eq!(
                computer.state.billing,
                BillingState::Active {
                    subscription_item: item("si_lost")
                },
                "{case}"
            );
        }
    }
}

#[tokio::test]
async fn an_unknown_charge_outcome_is_retried_with_the_same_key() {
    let billing = FakeBilling::default();
    billing.provider_error.store(true, Ordering::SeqCst);
    let service = service_with(repo_with_pool(), billing);
    service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();

    service.run_billing_effects().await.unwrap();

    let computer = service
        .repo
        .get(POOLED)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(computer.state.billing, BillingState::Charging);
    let charge = service
        .repo
        .effects
        .lock()
        .unwrap()
        .iter()
        .find(|pending| matches!(pending.effect, Effect::Charge { .. }))
        .cloned()
        .unwrap();
    assert_eq!(charge.attempts, 1);
}

#[tokio::test]
async fn a_team_with_an_unpaid_computer_buys_its_next_one_the_slow_way() {
    let repo = repo_with_pool();
    let mut second = computer(
        ComputerId::new_from_uuid(Uuid::from_u128(0x0b0c)),
        Phase::Running,
        BillingState::Pool,
    );
    second.state.macrod_connected = true;
    repo.computers.lock().unwrap().insert(second.id, second);
    let service = service_with(
        FakeRepo {
            sold_units: 3,
            ..repo
        },
        FakeBilling::default(),
    );

    let first = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    let next = service
        .purchase(standard_purchase("buy-dialog-2"))
        .await
        .unwrap();

    assert!(matches!(first, Purchase::Ready(_)));
    let Purchase::Ready(created) = next else {
        panic!("a charged reservation converts, got {next:?}");
    };
    assert_ne!(created, POOLED);
    assert_ne!(created.as_uuid(), Uuid::from_u128(0x0b0c));
    // The second purchase was charged before it returned, as today.
    assert_eq!(
        service
            .billing
            .adds
            .lock()
            .unwrap()
            .iter()
            .map(|add| add.computer_id)
            .collect::<Vec<_>>(),
        vec![created]
    );
}

#[tokio::test]
async fn an_empty_pool_or_another_size_creates_the_computer() {
    let cases = [
        (
            "no pool computer",
            FakeRepo {
                sold_units: 8,
                ..FakeRepo::default()
            },
            ComputerSize::Standard,
        ),
        (
            "a large computer",
            FakeRepo {
                sold_units: 8,
                ..repo_with_pool()
            },
            ComputerSize::Large,
        ),
    ];
    for (case, repo, size) in cases {
        let service = service_with(repo, FakeBilling::default());

        let purchase = service
            .purchase(PurchaseRequest {
                size,
                ..standard_purchase("buy-dialog-1")
            })
            .await
            .unwrap();

        assert_ne!(purchase.computer_id(), POOLED, "{case}");
        assert_eq!(*service.repo.reserve_calls.lock().unwrap(), 1, "{case}");
        assert_eq!(service.billing.adds.lock().unwrap().len(), 1, "{case}");
    }
}

#[tokio::test]
async fn a_pool_computer_cannot_be_reached_through_team_requests() {
    let service = service_with(repo_with_pool(), FakeBilling::default());

    assert!(service.list(TEAM).await.unwrap().is_empty());
    assert!(matches!(
        service.set_power(TEAM, POOLED, false).await,
        Err(ComputerError::NotFound)
    ));
}
