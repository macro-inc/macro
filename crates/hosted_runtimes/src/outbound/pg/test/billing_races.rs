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
use crate::domain::ports::{BillingError, ChargeStatus, ItemCharge, StaticFleetAttachment};
use crate::domain::service::{Clock, ComputerError, ComputerService, TeamComputerRelease};

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
    /// The team's subscription is in a trial.
    trialing: std::sync::atomic::AtomicBool,
    /// Stripe applies the next add, then its caller never hears back (the
    /// request future is dropped).
    hang_after_add: std::sync::atomic::AtomicBool,
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
        let fail = self.fail_next_add.lock().unwrap().take();
        match fail {
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
                if self
                    .hang_after_add
                    .swap(false, std::sync::atomic::Ordering::SeqCst)
                {
                    drop(subscription);
                    self.entered.notify_one();
                    std::future::pending::<()>().await;
                }
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

    async fn require_paid_plan(&self, _team_id: Uuid) -> Result<(), BillingError> {
        if self.trialing.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(BillingError::TeamOnTrial);
        }
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

/// Buy a computer through the service and settle its charge, so its item
/// is on the subscription.
async fn buy(service: &Service, key: &str) -> ComputerId {
    let id = match service.purchase(purchase_request(key)).await.unwrap() {
        Purchase::Ready(id) => id,
        other => panic!("expected a bought computer, got {other:?}"),
    };
    service.run_billing_effects().await.unwrap();
    id
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

    assert_eq!(stripe.items_for(id).await, std::slice::from_ref(&item));
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
/// the purchase's charge is in flight. The computer is released, and the
/// item the charge added is taken back, so nothing bills a deleted computer.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_deletion_during_a_charge_leaves_no_billed_computer(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let gate = stripe.gate();
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let Purchase::Ready(id) = service.purchase(purchase_request("buy-1")).await.unwrap() else {
        panic!("expected a ready purchase");
    };
    let service = Arc::new(service);
    let charge = tokio::spawn({
        let service = service.clone();
        async move { service.run_billing_effects().await }
    });
    stripe.entered.notified().await;

    TeamComputerRelease::new(repo.clone(), clock.clone())
        .release_team(TEAM)
        .await
        .unwrap();
    gate.add_permits(1);
    charge.await.unwrap().unwrap();

    let released = repo.get(id).await.unwrap().unwrap().into_healthy().unwrap();
    assert_eq!(released.state.phase, Phase::Destroying);
    assert!(stripe.items_for(id).await.is_empty());
    assert!(repo.team_reservations(TEAM).await.unwrap().is_empty());
}

/// A charge whose answer was lost, released before its retry: the retry
/// fences the add and takes the landed item back, so the team is never
/// billed for a computer it no longer has.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_charge_that_lands_after_release_is_taken_back(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let Purchase::Ready(id) = service.purchase(purchase_request("buy-1")).await.unwrap() else {
        panic!("expected a ready purchase");
    };
    // The add lands at Stripe, but its answer is lost: the computer stays charging.
    *stripe.fail_next_add.lock().unwrap() = Some(Fail::LostAnswer { landed: true });
    service.run_billing_effects().await.unwrap();
    assert_eq!(billing_of(&repo, id).await, Billing::Charging);
    assert_eq!(stripe.items_for(id).await.len(), 1);

    // Released before the retry learns the charge was paid.
    changed(&repo, id, Event::ReleaseNow, clock.now()).await;
    clock.advance(Duration::minutes(1));
    service.run_billing_effects().await.unwrap();

    assert!(stripe.items_for(id).await.is_empty());
    assert_eq!(
        repo.get(id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .state
            .phase,
        Phase::Destroying
    );
    // Nothing is left to retry, and a later pass charges nothing.
    clock.advance(Duration::hours(2));
    service.run_billing_effects().await.unwrap();
    assert!(stripe.items_for(id).await.is_empty());
    assert_eq!(
        stripe
            .keys()
            .iter()
            .filter(|key| **key == crate::domain::models::charge_key(id))
            .count(),
        1
    );
}

/// A purchase dropped between reserving and converting: its reservation
/// holds capacity until the confirm worker converts it, and the converted
/// computer is charged once, under the purchase's key.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reservation_left_behind_is_converted_and_charged_once(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let reservation = reserve(&repo, standard(1)).await;
    // Sold 9 units; the reservation holds one.
    for id in 2..=9 {
        reserve(
            &repo,
            NewReservation {
                team_id: Uuid::from_u128(id),
                ..standard(id)
            },
        )
        .await;
    }
    assert!(matches!(
        repo.reserve(
            NewReservation {
                team_id: Uuid::from_u128(10),
                ..standard(10)
            },
            clock.now(),
            clock.now() + Duration::minutes(15)
        )
        .await,
        Err(ReserveError::SoldOut)
    ));

    clock.advance(Duration::minutes(16));
    service.run_billing_effects().await.unwrap();
    service.run_billing_effects().await.unwrap();

    assert!(repo.reservation(reservation.id).await.unwrap().is_none());
    let item = stripe.items_for(reservation.id).await;
    assert_eq!(item.len(), 1);
    assert_eq!(
        billing_of(&repo, reservation.id).await,
        Billing::Active {
            subscription_item: item[0].clone(),
        }
    );
    let key = crate::domain::models::charge_key(reservation.id);
    assert_eq!(stripe.keys().iter().filter(|sent| **sent == key).count(), 1);
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
    assert_eq!(remaining, std::slice::from_ref(&kept));
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

/// Wolf's rule: computers are for paying teams. A trialing team's purchase
/// is refused before anything is reserved or charged, and so are undo and
/// restore, even when an item is still on the subscription to reuse.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_trialing_team_cannot_buy_undo_or_restore(pool: PgPool) {
    use std::sync::atomic::Ordering;
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let undone = buy(&service, "buy-1").await;
    let restored = buy(&service, "buy-2").await;
    service.cancel(TEAM, undone).await.unwrap();
    service.cancel(TEAM, restored).await.unwrap();
    service.run_billing_effects().await.unwrap();
    clock.advance(Duration::days(21));
    changed(&repo, restored, Event::BillingEnds, clock.now()).await;
    // Undo would reuse this item; the trial still refuses it.
    let leftover = {
        let mut subscription = stripe.subscription.lock().await;
        Stripe::add_item(&mut subscription, undone)
    };
    clock.advance(Duration::days(-20));
    let keys_before = stripe.keys().len();
    stripe.trialing.store(true, Ordering::SeqCst);

    let purchase = service.purchase(purchase_request("buy-3")).await;
    assert!(
        matches!(
            purchase,
            Err(ComputerError::Billing(BillingError::TeamOnTrial))
        ),
        "{purchase:?}"
    );
    assert!(repo.team_reservations(TEAM).await.unwrap().is_empty());
    assert!(matches!(
        service.undo_cancel(TEAM, undone).await,
        Err(ComputerError::Billing(BillingError::TeamOnTrial))
    ));
    clock.advance(Duration::days(20));
    assert!(matches!(
        service.restore(TEAM, restored).await,
        Err(ComputerError::Billing(BillingError::TeamOnTrial))
    ));

    assert_eq!(
        stripe.keys().len(),
        keys_before,
        "nothing was sent to Stripe"
    );
    assert_eq!(stripe.items_for(undone).await, [leftover]);
    assert!(stripe.items_for(restored).await.is_empty());
    assert_eq!(repo.list_for_team(TEAM).await.unwrap().len(), 2);
    assert!(matches!(
        billing_of(&repo, undone).await,
        Billing::EndsAt { .. }
    ));
    assert!(matches!(
        billing_of(&repo, restored).await,
        Billing::EndsAt { .. }
    ));
}

/// Review 2, NS2: a computer whose row no longer decodes (quarantined) still
/// has its queued item removal run, and it never stops the rest of the pass.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_quarantined_computer_neither_keeps_billing_nor_blocks_the_pass(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, _clock) = service(pool.clone(), stripe.clone()).await;
    let quarantined = buy(&service, "buy-1").await;
    let healthy = buy(&service, "buy-2").await;
    // The quarantined computer's removal is queued first.
    service.cancel(TEAM, quarantined).await.unwrap();
    service.cancel(TEAM, healthy).await.unwrap();
    sqlx::query!(
        "UPDATE hosted_runtime SET state = '{}'::jsonb WHERE id = $1",
        quarantined.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.get(quarantined)
            .await
            .unwrap()
            .unwrap()
            .healthy()
            .is_none()
    );

    service.run_billing_effects().await.unwrap();

    assert!(stripe.items_for(quarantined).await.is_empty());
    assert!(stripe.items_for(healthy).await.is_empty());
}

/// Review 2, NS1: a Restore whose charge went through but whose request was
/// dropped before the event applied. The webhook finishes the restore from
/// the paid item instead of stripping it, so a retry never charges again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_dropped_restore_is_finished_by_reconcile_not_charged_twice(pool: PgPool) {
    let stripe = Arc::new(Stripe::default());
    let (service, repo, clock) = service(pool, stripe.clone()).await;
    let id = buy(&service, "buy-1").await;
    service.cancel(TEAM, id).await.unwrap();
    service.run_billing_effects().await.unwrap();
    clock.advance(Duration::days(21));
    changed(&repo, id, Event::BillingEnds, clock.now()).await;

    stripe
        .hang_after_add
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let service = Arc::new(service);
    let restore = tokio::spawn({
        let service = service.clone();
        async move { service.restore(TEAM, id).await }
    });
    stripe.entered.notified().await;
    restore.abort();
    let _ = restore.await;
    let [item] = stripe.items_for(id).await.try_into().unwrap();
    assert!(matches!(
        billing_of(&repo, id).await,
        Billing::EndsAt { .. }
    ));

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

    assert_eq!(stripe.items_for(id).await, std::slice::from_ref(&item));
    assert_eq!(
        billing_of(&repo, id).await,
        Billing::Active {
            subscription_item: item
        }
    );
    assert!(service.restore(TEAM, id).await.is_err(), "already restored");
    let restores = stripe
        .keys()
        .into_iter()
        .filter(|key| key.starts_with("computer-restore:"))
        .count();
    assert_eq!(restores, 1, "one charge for one restore");
}
