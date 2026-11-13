use macro_user_id::user_id::MacroUserIdStr;
use std::str::FromStr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::*;
use crate::domain::fakes::{FakeRepo, FixedClock, HOST, MovingClock, TEAM, now, policy};
use crate::domain::lifecycle::{
    Billing as BillingState, ComputerState, Effect, Phase, Power, SubscriptionItemId, TimerKind,
};
use crate::domain::models::{
    BillingStatus, ComputerStatusKind, FleetAttachment, Funding, Purchase, PurchaseKey,
    PurchaseRequest, SubscriptionItem,
};
use crate::domain::ports::{ChargeStatus, ItemCharge, StaticFleetAttachment};

mod comped;
mod quarantine;
mod rollout;
mod sold_resources;

/// What the fake subscription does with a removal.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum RemoveOutcome {
    #[default]
    Removed,
    NoSubscription,
    ProviderError,
}

/// One add request that reached billing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AddRequest {
    pub computer_id: ComputerId,
    pub price_id: stripe::PriceId,
    pub extra_items: Vec<SubscriptionItem>,
    pub charge: ItemCharge,
    pub key: String,
}

/// A subscription with one item per computer. An add replayed with a key
/// it already charged returns the same item, like Stripe's idempotency.
#[derive(Default)]
pub(crate) struct FakeBilling {
    pub quote_price: Option<stripe::PriceId>,
    pub not_sold: bool,
    pub sales_checks: Mutex<usize>,
    pub no_subscription: bool,
    pub yearly: bool,
    pub decline: bool,
    /// The add fails before it reaches the provider.
    pub provider_error: AtomicBool,
    /// The add is charged but its answer is lost.
    pub lose_response: AtomicBool,
    pub remove_outcome: Mutex<RemoveOutcome>,
    pub items: Mutex<Vec<(SubscriptionItemId, ComputerId)>>,
    pub charged_keys: Mutex<Vec<(String, SubscriptionItemId)>>,
    pub adds: Mutex<Vec<AddRequest>>,
    pub settled: Mutex<Vec<String>>,
    pub removals: Mutex<Vec<(SubscriptionItemId, String)>>,
    /// Keys whose change was given up while its outcome was unknown.
    pub abandoned_keys: Mutex<Vec<String>>,
    pub calls: Mutex<Vec<&'static str>>,
}

impl FakeBilling {
    /// Keys that were actually charged, in order.
    pub fn charges(&self) -> Vec<String> {
        self.charged_keys
            .lock()
            .unwrap()
            .iter()
            .map(|(key, _)| key.clone())
            .collect()
    }
}

impl Billing for FakeBilling {
    fn sales_available(&self) -> bool {
        *self.sales_checks.lock().unwrap() += 1;
        !self.not_sold
    }

    async fn quote(&self, _team_id: Uuid, size: ComputerSize) -> Result<Quote, BillingError> {
        self.calls.lock().unwrap().push("quote");
        if self.no_subscription {
            return Err(BillingError::NoSubscription);
        }
        Ok(Quote {
            size,
            price_id: self.quote_price.clone().unwrap_or_else(|| {
                stripe::PriceId::from_str(&format!("price_{}", size.as_ref())).unwrap()
            }),
            amount: 2000
                * i64::from(match size {
                    ComputerSize::Standard => 1,
                    ComputerSize::Large => 2,
                    ComputerSize::Xl => 4,
                }),
            currency: "usd".to_owned(),
            interval: if self.yearly {
                crate::domain::models::BillingInterval::Year
            } else {
                crate::domain::models::BillingInterval::Month
            },
        })
    }

    async fn add_computer(
        &self,
        _team_id: Uuid,
        computer_id: ComputerId,
        price_id: &stripe::PriceId,
        extra_items: &[SubscriptionItem],
        charge: ItemCharge,
        idempotency_key: &str,
    ) -> Result<SubscriptionItemId, BillingError> {
        self.calls.lock().unwrap().push("add_computer");
        self.adds.lock().unwrap().push(AddRequest {
            computer_id,
            price_id: price_id.clone(),
            extra_items: extra_items.to_vec(),
            charge,
            key: idempotency_key.to_owned(),
        });
        if self.provider_error.load(Ordering::SeqCst) {
            return Err(BillingError::Provider(rootcause::report!(
                "billing timed out"
            )));
        }
        if self.decline {
            return Err(BillingError::PaymentFailed);
        }
        let mut charged = self.charged_keys.lock().unwrap();
        let item = match charged.iter().find(|(key, _)| key == idempotency_key) {
            Some((_, item)) => item.clone(),
            None => {
                let mut items = self.items.lock().unwrap();
                let item: SubscriptionItemId = format!("si_{}", charged.len() + 1).parse().unwrap();
                items.push((item.clone(), computer_id));
                charged.push((idempotency_key.to_owned(), item.clone()));
                item
            }
        };
        if self.lose_response.load(Ordering::SeqCst) {
            return Err(BillingError::Provider(rootcause::report!(
                "the answer was lost"
            )));
        }
        Ok(item)
    }

    async fn settle_computer_add(
        &self,
        _team_id: Uuid,
        computer_id: ComputerId,
        idempotency_key: &str,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        self.calls.lock().unwrap().push("settle_computer_add");
        self.settled
            .lock()
            .unwrap()
            .push(idempotency_key.to_owned());
        Ok(self
            .items
            .lock()
            .unwrap()
            .iter()
            .find(|(_, id)| *id == computer_id)
            .map(|(item, _)| item.clone()))
    }

    async fn charge_status(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<ChargeStatus>, BillingError> {
        if self
            .abandoned_keys
            .lock()
            .unwrap()
            .iter()
            .any(|key| key == idempotency_key)
        {
            return Ok(Some(ChargeStatus::NotApplied));
        }
        if self
            .removals
            .lock()
            .unwrap()
            .iter()
            .any(|(_, key)| key == idempotency_key)
        {
            return Ok(Some(ChargeStatus::Applied));
        }
        if self
            .charged_keys
            .lock()
            .unwrap()
            .iter()
            .any(|(key, _)| key == idempotency_key)
        {
            return Ok(Some(ChargeStatus::Applied));
        }
        Ok(self
            .adds
            .lock()
            .unwrap()
            .iter()
            .any(|add| add.key == idempotency_key)
            .then_some(if self.decline {
                ChargeStatus::NotApplied
            } else {
                ChargeStatus::Pending
            }))
    }

    async fn computer_item(
        &self,
        _team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        self.calls.lock().unwrap().push("computer_item");
        Ok(self
            .items
            .lock()
            .unwrap()
            .iter()
            .find(|(_, id)| *id == computer_id)
            .map(|(item, _)| item.clone()))
    }

    async fn remove_computer(
        &self,
        _team_id: Uuid,
        subscription_item: &SubscriptionItemId,
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        self.calls.lock().unwrap().push("remove_computer");
        match *self.remove_outcome.lock().unwrap() {
            RemoveOutcome::Removed => {}
            RemoveOutcome::NoSubscription => return Err(BillingError::NoSubscription),
            RemoveOutcome::ProviderError => {
                return Err(BillingError::Provider(rootcause::report!("stripe is down")));
            }
        }
        self.items
            .lock()
            .unwrap()
            .retain(|(item, _)| item != subscription_item);
        self.removals
            .lock()
            .unwrap()
            .push((subscription_item.clone(), idempotency_key.to_owned()));
        Ok(())
    }

    async fn require_paid_plan(&self, _team_id: Uuid) -> Result<(), BillingError> {
        Ok(())
    }

    async fn period_end(&self, _team_id: Uuid) -> Result<DateTime<Utc>, BillingError> {
        self.calls.lock().unwrap().push("period_end");
        Ok(now() + chrono::Duration::days(20))
    }
}

pub(crate) fn admin() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap()
}

pub(crate) fn key(value: &str) -> PurchaseKey {
    PurchaseKey::try_new(value.to_owned()).unwrap()
}

pub(crate) fn item(value: &str) -> SubscriptionItemId {
    value.parse().unwrap()
}

/// A Stripe purchase of a standard computer with the buyer's `purchase_key`.
pub(crate) fn standard_purchase(purchase_key: &str) -> PurchaseRequest {
    PurchaseRequest {
        billing: PurchaseBilling::Stripe,
        purchase_key: key(purchase_key),
        team_id: TEAM,
        created_by: admin(),
        size: ComputerSize::Standard,
        name: None,
        extra_items: vec![],
    }
}

/// A standard computer of the team in `phase`, billed as `billing`.
pub(crate) fn computer(id: ComputerId, phase: Phase, billing: BillingState) -> Computer {
    let funding = match &billing {
        BillingState::Comped { reason } => Funding::Comped {
            reason: reason.clone(),
        },
        BillingState::Active { .. }
        | BillingState::PastDue { .. }
        | BillingState::EndsAt { .. } => Funding::Stripe {
            price_id: stripe::PriceId::from_str("price_standard").unwrap(),
        },
    };
    Computer {
        id,
        team_id: TEAM,
        name: ComputerName::try_new("Build box").unwrap(),
        size: ComputerSize::Standard,
        resources: crate::domain::size::ComputerResources {
            vcpus: crate::domain::size::Vcpus::new(4),
            memory_gib: crate::domain::size::MemoryGib::new(8),
            disk_gib: crate::domain::size::DiskGib::new(100),
        },
        catalog_entry: crate::domain::size::CatalogEntryId::try_new("standard@2026-11".to_owned())
            .unwrap(),
        funding,
        host: HOST,
        state: ComputerState {
            phase,
            power: Power::On,
            billing,
            billing_changed_at: now() - chrono::Duration::days(30),
            macrod_connected: false,
            provision_traceparent: None,
            setup: None,
            macrod_misses: 0,
            recent_crashes: vec![],
            power_on_requested: false,
            capacity_wait: None,
            retried_by_team: false,
        },
        harness_id: None,
        created_by: admin(),
        created_at: now() - chrono::Duration::days(30),
        enrolled_at: Some(now() - chrono::Duration::days(30)),
        setup_completed_at: None,
        default_agent_id: None,
        image: None,
        enrollment_generation: Default::default(),
    }
}

fn service_with(
    repo: FakeRepo,
    billing: FakeBilling,
) -> ComputerService<FakeRepo, FakeBilling, FixedClock, StaticFleetAttachment> {
    ComputerService::new(
        repo,
        billing,
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
}

fn effects_of(repo: &FakeRepo, computer_id: ComputerId) -> Vec<Effect> {
    repo.effects
        .lock()
        .unwrap()
        .iter()
        .filter(|pending| pending.computer_id == computer_id)
        .map(|pending| pending.effect.clone())
        .collect()
}

#[tokio::test]
async fn purchase_bills_the_computer_and_the_seat_in_one_update_then_provisions() {
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
    assert_eq!(stored.catalog_entry.as_str(), "standard@2026-11");
    assert_eq!(
        stored.funding,
        Funding::Stripe {
            price_id: stripe::PriceId::from_str("price_standard").unwrap()
        }
    );
    assert_eq!(
        stored.state.billing,
        BillingState::Active {
            subscription_item: item("si_1"),
        }
    );
    assert!(service.repo.reservations.lock().unwrap().is_empty());
    let status = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(status.name.as_str(), "Ada");
    assert_eq!(status.status, ComputerStatusKind::SettingUp);
    assert_eq!(status.billing, Some(BillingStatus::Active));
    assert_eq!(
        status.setup,
        Some(crate::domain::models::SetupProgress {
            step: crate::domain::models::SetupStep::Creating,
            position: 2,
            total: 5,
        })
    );
    assert_eq!(
        effects_of(&service.repo, computer_id),
        vec![Effect::Create {
            host: HOST,
            start: true,
            generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
        }]
    );
}

/// Edge case (a): a purchase whose charge outcome is unknown answers
/// "confirming", and buying again with the same key never charges twice or
/// buys a second computer, before or after the confirm worker settles it.
#[tokio::test]
async fn a_retried_purchase_with_the_same_key_never_charges_twice() {
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

    let first = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    let Purchase::Confirming(computer_id) = first else {
        panic!("expected a confirming purchase, got {first:?}");
    };
    let status = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(status.status, ComputerStatusKind::Purchasing);
    assert_eq!(status.billing, Some(BillingStatus::Purchasing));

    // Buy again from the same dialog: the same reservation, no new charge.
    let again = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    assert_eq!(again, Purchase::Confirming(computer_id));
    assert_eq!(service.billing.adds.lock().unwrap().len(), 1);

    // The worker replays the same idempotent update and converts.
    service.billing.lose_response.store(false, Ordering::SeqCst);
    clock.advance(CONFIRM_DELAY);
    assert_eq!(service.confirm_reservations().await.unwrap(), 1);

    let after = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap();
    assert_eq!(after, Purchase::Ready(computer_id));
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
    assert_eq!(service.list(TEAM).await.unwrap().len(), 1);
    assert_eq!(
        service.status(TEAM, computer_id).await.unwrap().billing,
        Some(BillingStatus::Active)
    );
}

/// Edge case (a): an error shown to the buyer always means nothing was
/// charged, and the next purchase from the dialog charges afresh.
#[tokio::test]
async fn a_declined_purchase_drops_the_reservation_and_charges_nothing() {
    let service = service_with(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            decline: true,
            ..FakeBilling::default()
        },
    );

    let result = service.purchase(standard_purchase("buy-dialog-1")).await;

    assert!(matches!(
        result,
        Err(ComputerError::Billing(BillingError::PaymentFailed))
    ));
    assert!(service.billing.charges().is_empty());
    assert!(service.repo.reservations.lock().unwrap().is_empty());
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.list(TEAM).await.unwrap().is_empty());
    assert_eq!(service.confirm_reservations().await.unwrap(), 0);
}

#[tokio::test]
async fn an_expired_reservation_whose_charge_never_landed_is_deleted_uncharged() {
    let clock = MovingClock::new();
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            provider_error: AtomicBool::new(true),
            ..FakeBilling::default()
        },
        clock.clone(),
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    let Purchase::Confirming(computer_id) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a confirming purchase");
    };

    clock.advance(CONFIRM_DELAY);
    assert_eq!(service.confirm_reservations().await.unwrap(), 0);
    assert_eq!(service.repo.reservations.lock().unwrap().len(), 1);

    clock.advance(RESERVATION_TTL);
    assert_eq!(service.confirm_reservations().await.unwrap(), 1);

    assert!(service.repo.reservations.lock().unwrap().is_empty());
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert_eq!(
        *service.billing.settled.lock().unwrap(),
        vec![format!("computer-add:{computer_id}")]
    );
    assert!(service.billing.charges().is_empty());
    assert!(matches!(
        service.status(TEAM, computer_id).await,
        Err(ComputerError::NotFound)
    ));
}

#[tokio::test]
async fn an_expired_reservation_whose_charge_landed_becomes_the_computer() {
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
    let Purchase::Confirming(computer_id) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a confirming purchase");
    };

    clock.advance(RESERVATION_TTL);
    assert_eq!(service.confirm_reservations().await.unwrap(), 1);

    let computer = service
        .repo
        .get(computer_id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        computer.state.billing,
        BillingState::Active {
            subscription_item: item("si_1"),
        }
    );
    assert_eq!(service.billing.charges().len(), 1);
}

#[tokio::test]
async fn a_used_purchase_key_from_another_team_is_a_conflict() {
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

    let other_team = service
        .purchase(PurchaseRequest {
            team_id: Uuid::from_u128(2),
            ..standard_purchase("buy-dialog-1")
        })
        .await;

    assert!(matches!(
        other_team,
        Err(ComputerError::PurchaseKeyConflict)
    ));
    assert_eq!(service.billing.charges().len(), 1);
}

#[tokio::test]
async fn sold_out_size_is_not_billed() {
    let service = service_with(FakeRepo::default(), FakeBilling::default());

    let result = service.purchase(standard_purchase("buy-dialog-1")).await;

    assert!(matches!(
        result,
        Err(ComputerError::SoldOut(ComputerSize::Standard))
    ));
    assert!(service.billing.adds.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disabled_sales_reject_purchase_before_reserving_capacity() {
    let service = service_with(
        FakeRepo::default(),
        FakeBilling {
            not_sold: true,
            ..FakeBilling::default()
        },
    );
    let result = service.purchase(standard_purchase("buy-dialog-1")).await;
    assert!(matches!(
        result,
        Err(ComputerError::Billing(BillingError::NotAvailable))
    ));
    assert_eq!(*service.repo.reserve_calls.lock().unwrap(), 0);
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

/// Edge case (h): requests on a purchase still being confirmed are refused
/// with a typed error rather than answering 200 and doing nothing.
#[tokio::test]
async fn requests_on_a_purchase_being_confirmed_are_not_purchased() {
    let service = service_with(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            provider_error: AtomicBool::new(true),
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

    assert!(matches!(
        service.cancel(TEAM, computer_id).await,
        Err(ComputerError::NotPurchased)
    ));
    assert!(matches!(
        service.undo_cancel(TEAM, computer_id).await,
        Err(ComputerError::NotPurchased)
    ));
    assert!(matches!(
        service.restore(TEAM, computer_id).await,
        Err(ComputerError::NotPurchased)
    ));
    assert!(matches!(
        service
            .release_now(TEAM, computer_id, "Macro computer")
            .await,
        Err(ComputerError::NotPurchased)
    ));
    assert!(matches!(
        service.set_power(TEAM, computer_id, false).await,
        Err(ComputerError::NotPurchased)
    ));
    assert!(matches!(
        service.retry(TEAM, computer_id).await,
        Err(ComputerError::NotPurchased)
    ));
    let listed = service.list(TEAM).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].status, ComputerStatusKind::Purchasing);
    assert!(matches!(
        service.status(Uuid::from_u128(2), computer_id).await,
        Err(ComputerError::NotFound)
    ));
}

#[tokio::test]
async fn release_now_needs_the_name_and_removes_the_item_once() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let billing = FakeBilling::default();
    billing
        .items
        .lock()
        .unwrap()
        .push((item("si_1"), computer_id));
    let service = service_with(repo, billing);

    assert!(matches!(
        service.release_now(TEAM, computer_id, "wrong").await,
        Err(ComputerError::ConfirmationMismatch)
    ));
    let status = service
        .release_now(TEAM, computer_id, "Build box")
        .await
        .unwrap();
    assert_eq!(status.status, ComputerStatusKind::Released);
    assert!(matches!(
        service.release_now(TEAM, computer_id, "Build box").await,
        Err(ComputerError::Rejected(Rejected::Released))
    ));
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(service.billing.removals.lock().unwrap().len(), 1);
    assert!(service.billing.items.lock().unwrap().is_empty());
}

/// Edge case (e): removing an item whose subscription is already gone
/// counts as removed, instead of retrying forever.
#[tokio::test]
async fn removing_an_item_whose_subscription_is_gone_completes() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let billing = FakeBilling::default();
    *billing.remove_outcome.lock().unwrap() = RemoveOutcome::NoSubscription;
    let service = service_with(repo, billing);
    service
        .release_now(TEAM, computer_id, "Build box")
        .await
        .unwrap();

    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    assert!(
        !effects_of(&service.repo, computer_id)
            .iter()
            .any(|effect| matches!(effect, Effect::RemoveBillingItem { .. }))
    );
}

/// A removal released with one billed item, and its effect's id.
async fn released_with_removal(billing: FakeBilling) -> (
    ComputerService<FakeRepo, FakeBilling, std::sync::Arc<MovingClock>, StaticFleetAttachment>,
    std::sync::Arc<MovingClock>,
    i64,
) {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let clock = MovingClock::new();
    let service = ComputerService::new(
        repo,
        billing,
        clock.clone(),
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    service
        .release_now(TEAM, computer_id, "Build box")
        .await
        .unwrap();
    let removal_id = service
        .repo
        .effects
        .lock()
        .unwrap()
        .iter()
        .find(|pending| matches!(pending.effect, Effect::RemoveBillingItem { .. }))
        .unwrap()
        .id;
    (service, clock, removal_id)
}

/// A retried removal sends its own key again, so the subscription guard
/// lets it replay its change instead of refusing it as another one in flight.
#[tokio::test]
async fn a_retried_removal_reuses_its_own_key() {
    let billing = FakeBilling::default();
    *billing.remove_outcome.lock().unwrap() = RemoveOutcome::ProviderError;
    let (service, clock, removal_id) = released_with_removal(billing).await;
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    *service.billing.remove_outcome.lock().unwrap() = RemoveOutcome::Removed;
    clock.advance(chrono::Duration::hours(1));
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    assert_eq!(
        *service.billing.removals.lock().unwrap(),
        vec![(item("si_1"), format!("computer-remove:{removal_id}:0"))]
    );
}

/// A pool timeout is not the removal's failure: no attempt is spent and the
/// removal runs, under the same key, once its lease expires.
#[tokio::test]
async fn a_pool_timeout_never_spends_a_removal_attempt() {
    let (service, clock, removal_id) = released_with_removal(FakeBilling::default()).await;
    let gets = service.repo.gets.load(std::sync::atomic::Ordering::SeqCst);
    *service.repo.unavailable_gets.lock().unwrap() = vec![gets + 1];

    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    let attempts = service
        .repo
        .effects
        .lock()
        .unwrap()
        .iter()
        .find(|pending| pending.id == removal_id)
        .unwrap()
        .attempts;
    assert_eq!(attempts, 0);
    assert!(service.billing.removals.lock().unwrap().is_empty());
    clock.advance(chrono::Duration::minutes(3));
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(
        *service.billing.removals.lock().unwrap(),
        vec![(item("si_1"), format!("computer-remove:{removal_id}:0"))]
    );
}

/// Only a key whose change was given up is spent: the next one is used, and
/// a removal that already landed is not sent again.
#[tokio::test]
async fn a_removal_moves_past_an_abandoned_key_and_stops_once_one_landed() {
    let billing = FakeBilling::default();
    *billing.remove_outcome.lock().unwrap() = RemoveOutcome::ProviderError;
    let (service, clock, removal_id) = released_with_removal(billing).await;
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    service
        .billing
        .abandoned_keys
        .lock()
        .unwrap()
        .push(format!("computer-remove:{removal_id}:0"));

    *service.billing.remove_outcome.lock().unwrap() = RemoveOutcome::Removed;
    clock.advance(chrono::Duration::hours(1));
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);

    assert_eq!(
        *service.billing.removals.lock().unwrap(),
        vec![(item("si_1"), format!("computer-remove:{removal_id}:1"))]
    );
    assert!(
        service
            .repo
            .effects
            .lock()
            .unwrap()
            .iter()
            .all(|pending| pending.id != removal_id)
    );
}

/// Edge case (e): other removal failures back off and, after the attempt
/// cap, page and stop retrying.
#[tokio::test]
async fn a_failing_removal_backs_off_then_pages_and_stops() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let billing = FakeBilling::default();
    *billing.remove_outcome.lock().unwrap() = RemoveOutcome::ProviderError;
    let clock = MovingClock::new();
    let service = ComputerService::new(
        repo,
        billing,
        clock.clone(),
        StaticFleetAttachment(FleetAttachment::Attached),
    );
    service
        .release_now(TEAM, computer_id, "Build box")
        .await
        .unwrap();
    let removal_id = service
        .repo
        .effects
        .lock()
        .unwrap()
        .iter()
        .find(|pending| matches!(pending.effect, Effect::RemoveBillingItem { .. }))
        .unwrap()
        .id;

    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert_eq!(
        service.repo.effect_run_after.lock().unwrap()[&removal_id],
        now() + chrono::Duration::seconds(30)
    );
    for attempt in 1..billing::MAX_BILLING_ATTEMPTS {
        clock.advance(chrono::Duration::hours(1));
        assert_eq!(service.run_billing_effects().await.unwrap(), 1, "{attempt}");
    }

    assert!(
        service
            .repo
            .effects
            .lock()
            .unwrap()
            .iter()
            .all(|pending| pending.id != removal_id)
    );
    clock.advance(chrono::Duration::hours(1));
    assert_eq!(service.run_billing_effects().await.unwrap(), 0);
}

#[tokio::test]
async fn cancel_removes_the_item_now_and_undo_readds_it_without_proration() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_old"),
            },
        ),
    );
    let billing = FakeBilling::default();
    billing
        .items
        .lock()
        .unwrap()
        .push((item("si_old"), computer_id));
    let service = service_with(repo, billing);

    let canceled = service.cancel(TEAM, computer_id).await.unwrap();
    assert_eq!(canceled.billing, Some(BillingStatus::Ending));
    assert_eq!(
        canceled.cancels_at,
        Some(now() + chrono::Duration::days(20))
    );
    assert!(canceled.can_undo_cancel);
    assert_eq!(canceled.status, ComputerStatusKind::Ready);
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert!(service.billing.items.lock().unwrap().is_empty());

    let kept = service.undo_cancel(TEAM, computer_id).await.unwrap();

    assert_eq!(kept.billing, Some(BillingStatus::Active));
    let adds = service.billing.adds.lock().unwrap().clone();
    assert_eq!(adds.len(), 1);
    assert_eq!(adds[0].charge, ItemCharge::NoProration);
    assert!(
        adds[0]
            .key
            .starts_with(&format!("computer-undo:{computer_id}:"))
    );
    assert!(matches!(
        service.undo_cancel(TEAM, computer_id).await,
        Err(ComputerError::Rejected(Rejected::NotCanceled))
    ));
}

/// Edge case (g): restore during retention re-adds the item, prorated, and
/// keeps the stopped computer.
#[tokio::test]
async fn restore_during_retention_readds_the_item_prorated() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    let mut retained = computer(
        computer_id,
        Phase::Stopped,
        BillingState::EndsAt {
            at: now() - chrono::Duration::days(2),
        },
    );
    retained.state.power = Power::Off;
    repo.computers.lock().unwrap().insert(computer_id, retained);
    let service = service_with(repo, FakeBilling::default());
    let before = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(before.billing, Some(BillingStatus::Ended));
    assert_eq!(
        before.retained_until,
        Some(now() - chrono::Duration::days(2) + chrono::Duration::days(14))
    );
    assert!(before.can_restore);
    assert!(matches!(
        service.set_power(TEAM, computer_id, true).await,
        Err(ComputerError::Rejected(Rejected::BillingEnded))
    ));

    let restored = service.restore(TEAM, computer_id).await.unwrap();

    assert_eq!(restored.billing, Some(BillingStatus::Active));
    assert_eq!(restored.status, ComputerStatusKind::Stopped);
    assert!(!restored.can_restore);
    let adds = service.billing.adds.lock().unwrap().clone();
    assert_eq!(adds.len(), 1);
    assert_eq!(adds[0].charge, ItemCharge::Prorated);
    assert!(
        !effects_of(&service.repo, computer_id)
            .iter()
            .any(|effect| matches!(effect, Effect::Destroy { .. } | Effect::Create { .. }))
    );
    assert_eq!(
        service
            .set_power(TEAM, computer_id, true)
            .await
            .unwrap()
            .status,
        ComputerStatusKind::Starting
    );
}

#[tokio::test]
async fn a_retried_restore_reuses_the_item_an_earlier_attempt_left() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Stopped,
            BillingState::EndsAt {
                at: now() - chrono::Duration::days(2),
            },
        ),
    );
    let billing = FakeBilling::default();
    billing
        .items
        .lock()
        .unwrap()
        .push((item("si_left"), computer_id));
    let service = service_with(repo, billing);

    service.restore(TEAM, computer_id).await.unwrap();

    assert!(service.billing.adds.lock().unwrap().is_empty());
    assert_eq!(
        service
            .repo
            .get(computer_id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .billing,
        BillingState::Active {
            subscription_item: item("si_left"),
        }
    );
}

/// Edge case (d): reconcile matches items by the computer id in their
/// metadata, never by price or count, so it cancels only the computer whose
/// item is gone, and a snapshot read before a purchase never cancels it.
#[tokio::test]
async fn reconcile_matches_items_by_computer_id_never_by_count() {
    let kept = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let missing = ComputerId::new_from_uuid(Uuid::from_u128(2));
    let fresh = ComputerId::new_from_uuid(Uuid::from_u128(3));
    let repo = FakeRepo::default();
    for (id, subscription_item) in [
        (kept, "si_kept"),
        (missing, "si_missing"),
        (fresh, "si_fresh"),
    ] {
        repo.computers.lock().unwrap().insert(
            id,
            computer(
                id,
                Phase::Running,
                BillingState::Active {
                    subscription_item: item(subscription_item),
                },
            ),
        );
    }
    // Bought (its billing set) after the snapshot below was read.
    repo.computers
        .lock()
        .unwrap()
        .get_mut(&fresh)
        .unwrap()
        .state
        .billing_changed_at = now();
    let service = service_with(repo, FakeBilling::default());

    service
        .observe_subscription(
            TEAM,
            SubscriptionObserved {
                status: SubscriptionStatus::Active,
                items: vec![
                    // Same price as the missing computer's item; still not it.
                    ObservedItem {
                        subscription_item: item("si_kept"),
                        computer_id: Some(kept),
                    },
                    ObservedItem {
                        subscription_item: item("si_stranger"),
                        computer_id: Some(ComputerId::new_from_uuid(Uuid::from_u128(9))),
                    },
                    ObservedItem {
                        subscription_item: item("si_seats"),
                        computer_id: None,
                    },
                ],
                current_period_end: now() + chrono::Duration::days(20),
                observed_at: now() - chrono::Duration::seconds(1),
            },
        )
        .await
        .unwrap();

    let billing_of = |id| {
        service
            .repo
            .computers
            .lock()
            .unwrap()
            .get(&id)
            .unwrap()
            .state
            .billing
            .clone()
    };
    assert_eq!(
        billing_of(kept),
        BillingState::Active {
            subscription_item: item("si_kept"),
        }
    );
    assert_eq!(billing_of(missing), BillingState::EndsAt { at: now() });
    assert_eq!(
        billing_of(fresh),
        BillingState::Active {
            subscription_item: item("si_fresh"),
        }
    );
    assert!(
        !effects_of(&service.repo, missing)
            .iter()
            .any(|effect| matches!(effect, Effect::RemoveBillingItem { .. }))
    );
}

/// Edge case (b), service side: a past-due subscription marks billed
/// computers past due; a paid one again recovers them.
#[tokio::test]
async fn a_past_due_subscription_marks_its_computers_past_due_until_paid() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let service = service_with(repo, FakeBilling::default());
    let snapshot = |status| SubscriptionObserved {
        status,
        items: vec![ObservedItem {
            subscription_item: item("si_1"),
            computer_id: Some(computer_id),
        }],
        current_period_end: now() + chrono::Duration::days(20),
        observed_at: now(),
    };

    service
        .observe_subscription(TEAM, snapshot(SubscriptionStatus::Unpaid))
        .await
        .unwrap();
    let status = service.status(TEAM, computer_id).await.unwrap();
    assert_eq!(status.billing, Some(BillingStatus::PastDue));
    assert_eq!(status.past_due_since, Some(now()));
    assert!(
        effects_of(&service.repo, computer_id).contains(&Effect::ScheduleTimer {
            kind: TimerKind::PastDueGrace,
            at: now() + chrono::Duration::days(7),
        })
    );

    service
        .observe_subscription(TEAM, snapshot(SubscriptionStatus::Active))
        .await
        .unwrap();
    assert_eq!(
        service.status(TEAM, computer_id).await.unwrap().billing,
        Some(BillingStatus::Active)
    );
}

/// Edge case (c): deleting a team first releases its computers through the
/// normal effects and drops its purchases, so no billing is left.
#[tokio::test]
async fn deleting_a_team_releases_its_running_computer_and_leaves_no_billing() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo {
        sold_units: 9,
        ..FakeRepo::default()
    };
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let billing = FakeBilling {
        provider_error: AtomicBool::new(true),
        ..FakeBilling::default()
    };
    billing
        .items
        .lock()
        .unwrap()
        .push((item("si_1"), computer_id));
    let service = service_with(repo, billing);
    let Purchase::Confirming(pending) = service
        .purchase(standard_purchase("buy-dialog-1"))
        .await
        .unwrap()
    else {
        panic!("expected a confirming purchase");
    };

    team_release::release_team(&service.repo, &FixedClock, TEAM)
        .await
        .unwrap();

    assert_eq!(
        effects_of(&service.repo, computer_id),
        vec![
            Effect::RemoveBillingItem {
                subscription_item: item("si_1"),
            },
            Effect::Destroy { host: HOST },
            Effect::RevokeHarness,
        ]
    );
    assert!(service.repo.reservation(pending).await.unwrap().is_none());
    assert_eq!(service.run_billing_effects().await.unwrap(), 1);
    assert!(service.billing.items.lock().unwrap().is_empty());
    assert!(service.list(TEAM).await.unwrap().is_empty());
}

#[tokio::test]
async fn retry_a_computer_that_gave_up_restarts_without_billing() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Crashed {
                restarts: 3,
                retry: None,
            },
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let service = service_with(repo, FakeBilling::default());

    let status = service.retry(TEAM, computer_id).await.unwrap();

    assert_eq!(status.status, ComputerStatusKind::Starting);
    assert_eq!(
        effects_of(&service.repo, computer_id),
        vec![
            Effect::Restart { host: HOST },
            Effect::ScheduleTimer {
                kind: TimerKind::MacrodMissing,
                at: now() + crate::domain::lifecycle::MACROD_GRACE,
            },
        ]
    );
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn retry_a_running_computer_is_rejected_by_the_lifecycle() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let service = service_with(repo, FakeBilling::default());

    let result = service.retry(TEAM, computer_id).await;

    assert!(matches!(
        result,
        Err(ComputerError::Rejected(Rejected::NotFailed))
    ));
    assert!(service.repo.effects.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn other_teams_cannot_see_or_change_a_computer() {
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let repo = FakeRepo::default();
    repo.computers.lock().unwrap().insert(
        computer_id,
        computer(
            computer_id,
            Phase::Running,
            BillingState::Active {
                subscription_item: item("si_1"),
            },
        ),
    );
    let service = service_with(repo, FakeBilling::default());
    let other = Uuid::from_u128(2);

    assert!(matches!(
        service.status(other, computer_id).await,
        Err(ComputerError::NotFound)
    ));
    assert!(matches!(
        service.set_power(other, computer_id, false).await,
        Err(ComputerError::NotFound)
    ));
    assert!(matches!(
        service.retry(other, computer_id).await,
        Err(ComputerError::NotFound)
    ));
    assert!(service.list(other).await.unwrap().is_empty());
    assert!(service.repo.events.lock().unwrap().is_empty());
}

mod capacity;

mod waiting;

pub(crate) mod availability;
