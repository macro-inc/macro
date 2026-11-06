use super::*;

struct TeamCompPolicy;

impl CompPolicy for TeamCompPolicy {
    type Err = std::convert::Infallible;

    async fn comp_reason(&self, team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Ok((team_id == TEAM).then(|| "internal team".to_owned()))
    }
}

#[tokio::test]
async fn team_policy_controls_purchases_and_comped_computers_never_call_billing() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 8,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    )
    .with_comp_policy(TeamCompPolicy)
    .with_rollout(super::rollout::enabled_rollout());
    let id = service
        .purchase_for_team(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: Some("Build box".to_owned()),
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    let computer = service.repo.get(id).await.unwrap().unwrap();
    assert_eq!(computer.state.payment, PaymentOutcome::Comped);
    assert!(!computer.is_billed());
    assert_eq!(
        computer.status().comp_reason.as_deref(),
        Some("internal team")
    );
    assert!(service.billing.calls.lock().unwrap().is_empty());

    service.repo.effect_run_after.lock().unwrap().clear();
    service.run_billing_effects().await.unwrap();
    service.reconcile_billed_counts(TEAM, &[]).await.unwrap();
    assert_eq!(
        service.repo.get(id).await.unwrap().unwrap().state.billing,
        BillingState::Active
    );
    let canceled = service.cancel(TEAM, id).await.unwrap();
    assert_eq!(
        canceled.retained_until,
        Some(now() + crate::domain::lifecycle::RETENTION)
    );
    service.release_now(TEAM, id, "Build box").await.unwrap();
    service.run_billing_effects().await.unwrap();
    assert!(service.billing.calls.lock().unwrap().is_empty());

    let paid_id = service
        .purchase_for_team(PurchaseRequest {
            billing: PurchaseBilling::Comped {
                reason: "untrusted override".to_owned(),
            },
            team_id: Uuid::from_u128(99),
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await
        .unwrap();
    assert_eq!(
        service
            .repo
            .get(paid_id)
            .await
            .unwrap()
            .unwrap()
            .state
            .payment,
        PaymentOutcome::Paid
    );
    assert_eq!(
        *service.billing.calls.lock().unwrap(),
        vec!["quote", "add_computer"]
    );
}

#[tokio::test]
async fn comped_reservation_recovers_without_charging_and_release_skips_billing() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 8,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    );
    let id = ComputerId::new(Uuid::from_u128(18));
    service
        .repo
        .reserve(
            NewComputer {
                billing: PurchaseBilling::Comped {
                    reason: "internal team".to_owned(),
                },
                id,
                team_id: TEAM,
                name: ComputerName::try_new("Build box").unwrap(),
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
                price_id: None,
                persona: None,
                created_by: "macro|admin@example.com".to_owned(),
                extra_items: vec![],
            },
            now(),
        )
        .await
        .unwrap();
    service.repo.effect_run_after.lock().unwrap().clear();
    service.run_billing_effects().await.unwrap();
    assert_eq!(
        service.status(TEAM, id).await.unwrap().payment,
        PaymentOutcome::Comped
    );
    service.release_now(TEAM, id, "Build box").await.unwrap();
    service.run_billing_effects().await.unwrap();
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn comped_quote_preserves_stripe_terms_and_requires_a_subscription() {
    for (no_subscription, yearly) in [(false, false), (false, true), (true, false)] {
        let service = ComputerService::new(
            FakeRepo::default(),
            FakeBilling {
                no_subscription,
                yearly,
                ..FakeBilling::default()
            },
            FixedClock,
        )
        .with_comp_policy(TeamCompPolicy)
        .with_rollout(super::rollout::enabled_rollout());
        let quote = service
            .quote_for_team("macro|admin@example.com", TEAM, ComputerSize::Standard)
            .await;
        if no_subscription {
            assert!(matches!(
                quote,
                Err(ComputerError::Billing(BillingError::NoSubscription))
            ));
            continue;
        }
        let quote = quote.unwrap();
        assert_eq!(quote.amount, 0);
        assert_eq!(quote.currency, "usd");
        assert_eq!(
            quote.interval,
            if yearly {
                BillingInterval::Year
            } else {
                BillingInterval::Month
            }
        );
        assert_eq!(quote.price_id.as_str(), "price_standard");
    }
}

#[tokio::test]
async fn comped_purchase_rejects_subscription_items_before_reserving() {
    let service = ComputerService::new(FakeRepo::default(), FakeBilling::default(), FixedClock);
    let result = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Comped {
                reason: "internal team".to_owned(),
            },
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![SubscriptionItem {
                price_id: crate::domain::models::StripePriceId::parse("price_seat").unwrap(),
                quantity: 1,
            }],
        })
        .await;
    assert!(matches!(result, Err(ComputerError::BadRequest(_))));
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

struct UnavailablePolicy;

impl CompPolicy for UnavailablePolicy {
    type Err = crate::domain::fakes::FakeError;

    async fn comp_reason(&self, _team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Err(crate::domain::fakes::FakeError)
    }
}

#[tokio::test]
async fn policy_failure_cannot_reserve_or_charge_a_computer() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 8,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
    )
    .with_comp_policy(UnavailablePolicy)
    .with_rollout(super::rollout::enabled_rollout());
    let result = service
        .purchase_for_team(PurchaseRequest {
            billing: PurchaseBilling::Stripe,
            team_id: TEAM,
            created_by: "macro|admin@example.com".to_owned(),
            size: ComputerSize::Standard,
            name: None,
            persona: None,
            extra_items: vec![],
        })
        .await;
    assert!(matches!(result, Err(ComputerError::Internal(_))));
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}
