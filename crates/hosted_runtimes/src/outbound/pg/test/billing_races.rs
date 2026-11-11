//! Billing races against the real repository: its row and billing locks, its
//! outbox and reservations, with a Stripe stand-in that models what the
//! `teams` adapter guarantees (durable receipts keyed by idempotency key, one
//! subscription guard that settles a change left pending, fencing on settle).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{Notify, Semaphore};

use super::*;
use crate::domain::fakes::MovingClock;
use crate::domain::lifecycle::SubscriptionItemId;
use crate::domain::models::{Purchase, PurchaseBilling, PurchaseRequest, Quote, SubscriptionItem};
use crate::domain::ports::{
    Billing as _, BillingError, ChargeStatus, ItemCharge, StaticFleetAttachment,
};
use crate::domain::service::{Clock, ComputerService, TeamComputerRelease};

/// How the next add goes wrong.
#[derive(Debug, Clone, Copy)]
enum Fail {
    /// Stripe applied it (or not) and the answer was lost.
    LostAnswer { landed: bool },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Receipt {
    /// Sent with an unknown outcome; `landed` is what Stripe really did.
    Pending {
        landed: bool,
    },
    Applied,
    NotApplied,
}

#[derive(Default)]
struct Subscription {
    /// (item, computer id), as the subscription holds them.
    items: Vec<(SubscriptionItemId, ComputerId)>,
    receipts: HashMap<String, Receipt>,
    next_item: u32,
}

/// The team subscription, as the `teams` adapter presents it.
#[derive(Default)]
struct Stripe {
    subscription: tokio::sync::Mutex<Subscription>,
    /// Every key an add or removal was sent with, in order.
    keys: Mutex<Vec<String>>,
    fail_next_add: Mutex<Option<Fail>>,
    /// While set, an add waits for a permit after taking the guard.
    gate: Mutex<Option<Arc<Semaphore>>>,
    /// Signalled when an add reaches the gate.
    entered: Notify,
}

impl Stripe {
    /// From now on, hold every add until the returned gate gives it a permit.
    fn gate(&self) -> Arc<Semaphore> {
        let gate = Arc::new(Semaphore::new(0));
        *self.gate.lock().unwrap() = Some(gate.clone());
        gate
    }

    async fn items_for(&self, computer_id: ComputerId) -> Vec<SubscriptionItemId> {
        self.subscription
            .lock()
            .await
            .items
            .iter()
            .filter(|(_, id)| *id == computer_id)
            .map(|(item, _)| item.clone())
            .collect()
    }

    fn keys(&self) -> Vec<String> {
        self.keys.lock().unwrap().clone()
    }

    /// What the subscription guard does on entry: settle every other
    /// pending change by whether it landed.
    fn settle_others(subscription: &mut Subscription, own: &str) {
        for (key, receipt) in subscription.receipts.iter_mut() {
            if let Receipt::Pending { landed } = *receipt
                && key != own
            {
                *receipt = if landed {
                    Receipt::Applied
                } else {
                    Receipt::NotApplied
                };
            }
        }
    }

    fn add_item(subscription: &mut Subscription, computer_id: ComputerId) -> SubscriptionItemId {
        subscription.next_item += 1;
        let item: SubscriptionItemId = format!("si_{}", subscription.next_item).parse().unwrap();
        subscription.items.push((item.clone(), computer_id));
        item
    }
}

impl crate::domain::ports::Billing for Arc<Stripe> {
    fn sales_available(&self) -> bool {
        true
    }

    async fn quote(&self, _team_id: Uuid, size: ComputerSize) -> Result<Quote, BillingError> {
        Ok(Quote {
            size,
            price_id: "price_standard".parse().unwrap(),
            amount: 2000,
            currency: "usd".to_owned(),
            interval: crate::domain::models::BillingInterval::Month,
        })
    }

    async fn add_computer(
        &self,
        _team_id: Uuid,
        computer_id: ComputerId,
        _price_id: &stripe::PriceId,
        _extra_items: &[SubscriptionItem],
        _charge: ItemCharge,
        idempotency_key: &str,
    ) -> Result<SubscriptionItemId, BillingError> {
        let mut subscription = self.subscription.lock().await;
        Stripe::settle_others(&mut subscription, idempotency_key);
        self.keys.lock().unwrap().push(idempotency_key.to_owned());
        match subscription.receipts.get(idempotency_key).copied() {
            Some(Receipt::Applied) | Some(Receipt::Pending { landed: true }) => {
                subscription
                    .receipts
                    .insert(idempotency_key.to_owned(), Receipt::Applied);
                return subscription
                    .items
                    .iter()
                    .find(|(_, id)| *id == computer_id)
                    .map(|(item, _)| item.clone())
                    .ok_or_else(|| BillingError::Provider(rootcause::report!("item gone")));
            }
            Some(Receipt::NotApplied) => return Err(BillingError::PaymentFailed),
            Some(Receipt::Pending { landed: false }) | None => {}
        }
        let gate = self.gate.lock().unwrap().clone();
        if let Some(gate) = gate {
            self.entered.notify_one();
            gate.acquire().await.unwrap().forget();
        }
        match self.fail_next_add.lock().unwrap().take() {
            Some(Fail::LostAnswer { landed }) => {
                if landed {
                    Stripe::add_item(&mut subscription, computer_id);
                }
                subscription
                    .receipts
                    .insert(idempotency_key.to_owned(), Receipt::Pending { landed });
                Err(BillingError::Provider(rootcause::report!("answer lost")))
            }
            None => {
                let item = Stripe::add_item(&mut subscription, computer_id);
                subscription
                    .receipts
                    .insert(idempotency_key.to_owned(), Receipt::Applied);
                Ok(item)
            }
        }
    }

    async fn settle_computer_add(
        &self,
        _team_id: Uuid,
        computer_id: ComputerId,
        idempotency_key: &str,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        let mut subscription = self.subscription.lock().await;
        Stripe::settle_others(&mut subscription, idempotency_key);
        let settled = match subscription.receipts.get(idempotency_key).copied() {
            Some(Receipt::Pending { landed: true }) | Some(Receipt::Applied) => Receipt::Applied,
            // Never sent: fenced, so a send still on its way never charges.
            Some(Receipt::Pending { landed: false }) | Some(Receipt::NotApplied) | None => {
                Receipt::NotApplied
            }
        };
        subscription
            .receipts
            .insert(idempotency_key.to_owned(), settled);
        Ok(subscription
            .items
            .iter()
            .find(|(_, id)| *id == computer_id)
            .map(|(item, _)| item.clone()))
    }

    async fn charge_status(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<ChargeStatus>, BillingError> {
        Ok(self
            .subscription
            .lock()
            .await
            .receipts
            .get(idempotency_key)
            .map(|receipt| match receipt {
                Receipt::Pending { .. } => ChargeStatus::Pending,
                Receipt::Applied => ChargeStatus::Applied,
                Receipt::NotApplied => ChargeStatus::NotApplied,
            }))
    }

    async fn computer_item(
        &self,
        _team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        Ok(self.items_for(computer_id).await.into_iter().next())
    }

    async fn remove_computer(
        &self,
        _team_id: Uuid,
        subscription_item: &SubscriptionItemId,
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        let mut subscription = self.subscription.lock().await;
        Stripe::settle_others(&mut subscription, idempotency_key);
        self.keys.lock().unwrap().push(idempotency_key.to_owned());
        subscription
            .items
            .retain(|(item, _)| item != subscription_item);
        subscription
            .receipts
            .insert(idempotency_key.to_owned(), Receipt::Applied);
        Ok(())
    }

    async fn period_end(&self, _team_id: Uuid) -> Result<DateTime<Utc>, BillingError> {
        Ok(now() + Duration::days(20))
    }
}

type Service =
    ComputerService<PgComputerRepo, Arc<Stripe>, Arc<MovingClock>, StaticFleetAttachment>;

async fn service(pool: PgPool, stripe: Arc<Stripe>) -> (Service, PgComputerRepo, Arc<MovingClock>) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let clock = MovingClock::new();
    let service = ComputerService::new(
        repo.clone(),
        stripe,
        clock.clone(),
        StaticFleetAttachment(crate::domain::models::FleetAttachment::Attached),
    );
    (service, repo, clock)
}

fn purchase_request(key: &str) -> PurchaseRequest {
    PurchaseRequest {
        billing: PurchaseBilling::Stripe,
        purchase_key: PurchaseKey::try_new(key.to_owned()).unwrap(),
        team_id: TEAM,
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        size: ComputerSize::Standard,
        name: None,
        extra_items: vec![],
    }
}

/// Buy a computer through the service, so its item is on the subscription.
async fn buy(service: &Service, key: &str) -> ComputerId {
    match service.purchase(purchase_request(key)).await.unwrap() {
        Purchase::Ready(id) => id,
        other => panic!("expected a bought computer, got {other:?}"),
    }
}

async fn billing_of(repo: &PgComputerRepo, id: ComputerId) -> Billing {
    repo.get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap()
        .state
        .billing
}

/// Blocker B3: two admins restore the same computer at once. The second
/// waits for the first under the computer's billing guard, then finds it
/// already restored, so it never charges: one item, one charge.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_restores_charge_once(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let id = buy(&service, "buy-1").await;
    service.cancel(TEAM, id).await.unwrap();
    service.run_billing_effects().await.unwrap();
    clock.advance(Duration::days(21));
    changed(&repo, id, Event::BillingEnds, clock.now()).await;
    assert!(stripe.items_for(id).await.is_empty());

    let gate = stripe.gate();
    let service = Arc::new(service);
    let first = tokio::spawn({
        let service = service.clone();
        async move { service.restore(TEAM, id).await }
    });
    stripe.entered.notified().await;
    let second = tokio::spawn({
        let service = service.clone();
        async move { service.restore(TEAM, id).await }
    });
    // Give the second request time to check the state and reach the charge
    // too. With the billing guard it waits for the first instead, so it
    // never arrives and this times out.
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        stripe.entered.notified(),
    )
    .await;
    gate.add_permits(2);
    let outcomes = [first.await.unwrap(), second.await.unwrap()];

    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    let items = stripe.items_for(id).await;
    assert_eq!(items.len(), 1);
    assert_eq!(
        billing_of(&repo, id).await,
        Billing::Active {
            subscription_item: items[0].clone()
        }
    );
}

/// Blocker B2: Cancel then Undo before the queued removal runs. Undo keeps
/// the item still on the subscription, and the removal, deciding under the
/// billing guard, sees the computer billed on it again and leaves it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn undo_before_the_queued_removal_keeps_the_item(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, _clock) = service(pool, stripe.clone()).await;
    let id = buy(&service, "buy-1").await;
    let [item] = stripe.items_for(id).await.try_into().unwrap();

    service.cancel(TEAM, id).await.unwrap();
    service.undo_cancel(TEAM, id).await.unwrap();
    service.run_billing_effects().await.unwrap();

    assert_eq!(stripe.items_for(id).await, [item.clone()]);
    assert_eq!(
        billing_of(&repo, id).await,
        Billing::Active {
            subscription_item: item
        }
    );
    assert!(
        stripe
            .keys()
            .iter()
            .all(|key| !key.starts_with("computer-remove:"))
    );
}

/// Blocker B1: a restore whose answer was lost leaves a pending change. The
/// retry replays the same key rather than minting a new one, so the change
/// ends (here as never applied, then charged once by the replay), and a later
/// change is never refused because of it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lost_restore_answer_is_retried_on_the_same_key(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let id = buy(&service, "buy-1").await;
    service.cancel(TEAM, id).await.unwrap();
    service.run_billing_effects().await.unwrap();
    clock.advance(Duration::days(21));
    changed(&repo, id, Event::BillingEnds, clock.now()).await;

    *stripe.fail_next_add.lock().unwrap() = Some(Fail::LostAnswer { landed: false });
    assert!(service.restore(TEAM, id).await.is_err());
    service.restore(TEAM, id).await.unwrap();

    let restores: Vec<String> = stripe
        .keys()
        .into_iter()
        .filter(|key| key.starts_with("computer-restore:"))
        .collect();
    assert_eq!(restores.len(), 2);
    assert_eq!(restores[0], restores[1], "the retry reuses the key");
    assert_eq!(stripe.items_for(id).await.len(), 1);
    let receipts = &stripe.subscription.lock().await.receipts;
    assert!(
        receipts
            .values()
            .all(|receipt| !matches!(receipt, Receipt::Pending { .. })),
        "{receipts:?}"
    );
}

/// Should-fix S7 and team deletion mid-purchase: the team is deleted while
/// the purchase is charging. The deleted reservation never becomes a
/// computer, and the purchase answers Confirming, never an error after a charge.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_deletion_during_a_charge_leaves_no_computer(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let gate = stripe.gate();
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let service = Arc::new(service);
    let purchase = tokio::spawn({
        let service = service.clone();
        async move { service.purchase(purchase_request("buy-1")).await }
    });
    stripe.entered.notified().await;

    TeamComputerRelease::new(repo.clone(), clock.clone())
        .release_team(TEAM)
        .await
        .unwrap();
    gate.add_permits(1);
    let outcome = purchase.await.unwrap().unwrap();

    assert!(matches!(outcome, Purchase::Confirming(_)), "{outcome:?}");
    assert!(repo.list_for_team(TEAM).await.unwrap().is_empty());
    assert!(repo.team_reservations(TEAM).await.unwrap().is_empty());
}

/// Should-fix S1 and S2: an expired reservation keeps holding capacity
/// until it settles, and settling it fences its charge, so a send still on
/// its way (another replica) cannot charge after the reservation is gone.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_expired_reservation_settles_fenced_and_holds_capacity_until_then(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let reservation = reserve(&repo, standard(1)).await;
    clock.advance(Duration::minutes(16));
    // Sold 9 units; the expired reservation still holds one.
    for id in 2..=9 {
        reserve(&repo, NewReservation { ..standard(id) }).await;
    }
    assert!(matches!(
        repo.reserve(
            standard(10),
            clock.now(),
            clock.now() + Duration::minutes(15)
        )
        .await,
        Err(ReserveError::SoldOut)
    ));

    service.confirm_reservations().await.unwrap();
    assert!(repo.reservation(reservation.id).await.unwrap().is_none());
    // The late send from another replica finds its key fenced.
    assert!(matches!(
        stripe
            .add_computer(
                TEAM,
                reservation.id,
                &"price_standard".parse().unwrap(),
                &[],
                ItemCharge::Prorated,
                &reservation.charge_key(),
            )
            .await,
        Err(BillingError::PaymentFailed)
    ));
    assert!(stripe.items_for(reservation.id).await.is_empty());
}

/// Blocker B3 and should-fix S8: reconcile removes items naming a computer
/// that is not billed on them (a duplicate, or one left by a restore whose
/// event was refused) and items naming no live computer, but never the item
/// a computer is billed on.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconcile_removes_items_no_computer_is_billed_on(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let billed = buy(&service, "buy-1").await;
    let canceled = buy(&service, "buy-2").await;
    service.cancel(TEAM, canceled).await.unwrap();
    let unknown = ComputerId::new_from_uuid(Uuid::from_u128(77));
    let (kept, duplicate, left, orphan) = {
        let mut subscription = stripe.subscription.lock().await;
        let kept = subscription.items[0].0.clone();
        let duplicate = Stripe::add_item(&mut subscription, billed);
        let left = subscription
            .items
            .iter()
            .find(|(_, id)| *id == canceled)
            .unwrap()
            .0
            .clone();
        let orphan = Stripe::add_item(&mut subscription, unknown);
        (kept, duplicate, left, orphan)
    };
    clock.advance(Duration::seconds(1));
    let observed = {
        let subscription = stripe.subscription.lock().await;
        crate::domain::service::SubscriptionObserved {
            status: crate::domain::service::SubscriptionStatus::Active,
            items: subscription
                .items
                .iter()
                .map(|(item, id)| crate::domain::service::ObservedItem {
                    subscription_item: item.clone(),
                    computer_id: Some(*id),
                })
                .collect(),
            current_period_end: now() + Duration::days(20),
            observed_at: clock.now(),
        }
    };

    service.observe_subscription(TEAM, observed).await.unwrap();

    let remaining: Vec<SubscriptionItemId> = stripe
        .subscription
        .lock()
        .await
        .items
        .iter()
        .map(|(item, _)| item.clone())
        .collect();
    assert_eq!(remaining, [kept.clone()]);
    for gone in [duplicate, left, orphan] {
        assert!(!remaining.contains(&gone));
    }
    assert_eq!(
        billing_of(&repo, billed).await,
        Billing::Active {
            subscription_item: kept
        }
    );
}
