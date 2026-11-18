use super::*;
use crate::domain::service::billing::{SubscriptionObserved, SubscriptionStatus};
use macro_user_id::user_id::MacroUserIdStr;
use std::str::FromStr;

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
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_comp_policy(TeamCompPolicy)
    .with_rollout(super::rollout::enabled_rollout());
    let purchase = service
        .purchase_for_team(PurchaseRequest {
            name: Some("Build box".to_owned()),
            ..standard_purchase("buy-dialog-1")
        })
        .await
        .unwrap();
    let Purchase::Ready(id) = purchase else {
        panic!("a comp converts at once, got {purchase:?}");
    };
    let computer = service
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        computer.state.billing,
        BillingState::Comped {
            reason: "internal team".to_owned()
        }
    );
    let status = computer.status(0, now(), policy());
    assert_eq!(status.comp_reason.as_deref(), Some("internal team"));
    assert_eq!(status.billing, Some(BillingStatus::Comped));
    assert!(service.billing.calls.lock().unwrap().is_empty());

    service
        .observe_subscription(
            TEAM,
            SubscriptionObserved {
                status: SubscriptionStatus::Canceled,
                items: vec![],
                current_period_end: now(),
                observed_at: now(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        service
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .billing,
        BillingState::Comped {
            reason: "internal team".to_owned()
        }
    );
    let canceled = service.cancel(TEAM, id).await.unwrap();
    assert_eq!(canceled.billing, Some(BillingStatus::Ended));
    assert_eq!(
        canceled.retained_until,
        Some(now() + chrono::Duration::days(14))
    );
    let restored = service.restore(TEAM, id).await.unwrap();
    assert_eq!(restored.billing, Some(BillingStatus::Comped));
    service.release_now(TEAM, id, "Build box").await.unwrap();
    service.run_billing_effects().await.unwrap();
    assert!(service.billing.calls.lock().unwrap().is_empty());

    let paid = service
        .purchase_for_team(PurchaseRequest {
            billing: PurchaseBilling::Comped {
                reason: "untrusted override".to_owned(),
            },
            team_id: Uuid::from_u128(99),
            ..standard_purchase("buy-dialog-2")
        })
        .await
        .unwrap();
    assert!(matches!(
        service
            .repo
            .get(paid.computer_id())
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .billing,
        BillingState::Active { .. }
    ));
    assert_eq!(
        *service.billing.calls.lock().unwrap(),
        vec!["quote", "add_computer"]
    );
}

#[tokio::test]
async fn comped_quote_preserves_stripe_terms_and_requires_a_subscription() {
    for (no_subscription, yearly) in [(false, false), (false, true), (true, false)] {
        let service = ComputerService::new(
            FakeRepo {
                sold_units: 9,
                ..FakeRepo::default()
            },
            FakeBilling {
                no_subscription,
                yearly,
                ..FakeBilling::default()
            },
            FixedClock,
            StaticFleetAttachment(FleetAttachment::Attached),
        )
        .with_comp_policy(TeamCompPolicy)
        .with_rollout(super::rollout::enabled_rollout());
        let quote = service
            .offers(
                TEAM,
                MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
            )
            .await
            .map(|offers| {
                offers
                    .into_iter()
                    .find(|offer| offer.size == ComputerSize::Standard)
                    .unwrap()
                    .quote
            });
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
                crate::domain::models::BillingInterval::Year
            } else {
                crate::domain::models::BillingInterval::Month
            }
        );
        assert_eq!(quote.price_id.as_str(), "price_standard");
    }
}

#[tokio::test]
async fn comped_purchase_rejects_subscription_items_before_reserving() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let result = service
        .purchase(PurchaseRequest {
            billing: PurchaseBilling::Comped {
                reason: "internal team".to_owned(),
            },
            extra_items: vec![SubscriptionItem {
                price_id: stripe::PriceId::from_str("price_seat").unwrap(),
                quantity: 1,
            }],
            ..standard_purchase("buy-dialog-1")
        })
        .await;
    assert!(matches!(result, Err(ComputerError::CompedExtraItems)));
    assert_eq!(*service.repo.reserve_calls.lock().unwrap(), 0);
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

struct UnavailablePolicy;

impl CompPolicy for UnavailablePolicy {
    type Err = crate::domain::fakes::FakeError;

    async fn comp_reason(&self, _team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Err(crate::domain::fakes::FakeError::Storage)
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
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_comp_policy(UnavailablePolicy)
    .with_rollout(super::rollout::enabled_rollout());
    let result = service
        .purchase_for_team(standard_purchase("buy-dialog-1"))
        .await;
    assert!(matches!(result, Err(ComputerError::Internal(_))));
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

/// A comp the team can lose: its reason, or none once the team pays.
struct ChangingCompPolicy(std::sync::Mutex<Option<String>>);

impl CompPolicy for ChangingCompPolicy {
    type Err = std::convert::Infallible;

    async fn comp_reason(&self, _team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Ok(self.0.lock().unwrap().clone())
    }
}

#[tokio::test]
async fn restore_comps_again_only_while_the_team_is_still_comped() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 8,
            ..FakeRepo::default()
        },
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_comp_policy(ChangingCompPolicy(std::sync::Mutex::new(Some(
        "internal team".to_owned(),
    ))))
    .with_rollout(super::rollout::enabled_rollout());
    let id = service
        .purchase_for_team(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
        .computer_id();
    service.cancel(TEAM, id).await.unwrap();

    *service.comp_policy.0.lock().unwrap() = None;
    let refused = service.restore(TEAM, id).await;
    assert!(
        matches!(
            refused,
            Err(ComputerError::Rejected(Rejected::InvalidRestore))
        ),
        "{refused:?}"
    );

    *service.comp_policy.0.lock().unwrap() = Some("internal team".to_owned());
    let restored = service.restore(TEAM, id).await.unwrap();
    assert_eq!(restored.billing, Some(BillingStatus::Comped));
    assert!(service.billing.calls.lock().unwrap().is_empty());
}
