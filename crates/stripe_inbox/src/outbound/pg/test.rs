//! The inbox against MacroDB: receiving, ordering, deduping, superseding,
//! leasing, retrying and dead-lettering, driven through `InboxService`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::*;
use crate::domain::model::{ApplyError, BillingInboxEvent, Delivery};
use crate::domain::ports::{EventConsumers, Page, StripeReadError, StripeReader};
use crate::domain::service::{InboxService, LEASE, MAX_ATTEMPTS};

/// Stripe as the tests see it: subscriptions by id, and a count of reads.
#[derive(Default)]
struct FakeStripe {
    subscriptions: Mutex<HashMap<String, Value>>,
    reads: Mutex<Vec<String>>,
}

impl StripeReader for FakeStripe {
    async fn retrieve_subscription(&self, id: &SubscriptionId) -> Result<Value, StripeReadError> {
        self.reads
            .lock()
            .unwrap()
            .push(format!("subscription {id}"));
        self.subscriptions
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or(StripeReadError::RateLimited)
    }

    async fn subscription_items(&self, id: &SubscriptionId) -> Result<Vec<Value>, StripeReadError> {
        self.reads.lock().unwrap().push(format!("items {id}"));
        Ok(Vec::new())
    }

    async fn customer_subscriptions(
        &self,
        customer: &CustomerId,
    ) -> Result<Vec<Value>, StripeReadError> {
        self.reads.lock().unwrap().push(format!("list {customer}"));
        Ok(self
            .subscriptions
            .lock()
            .unwrap()
            .values()
            .filter(|subscription| subscription["customer"] == customer.as_str())
            .cloned()
            .collect())
    }

    async fn retrieve_customer(&self, customer: &CustomerId) -> Result<Value, StripeReadError> {
        self.reads
            .lock()
            .unwrap()
            .push(format!("customer {customer}"));
        Err(StripeReadError::RateLimited)
    }

    async fn events(
        &self,
        _since: DateTime<Utc>,
        _starting_after: Option<&EventId>,
    ) -> Result<Page, StripeReadError> {
        Ok(Page::default())
    }

    async fn subscriptions(
        &self,
        _starting_after: Option<&SubscriptionId>,
    ) -> Result<Page, StripeReadError> {
        Ok(Page::default())
    }
}

/// What the consumer would do with the next delivery.
#[derive(Clone, Copy)]
enum Outcome {
    Retry,
    Reject,
}

/// Records every delivery; fails the consumers it is told to.
#[derive(Default)]
struct Recorder {
    applied: Mutex<Vec<(Consumer, String, usize)>>,
    failing: Mutex<HashMap<Consumer, Outcome>>,
}

impl Recorder {
    fn applied(&self, consumer: Consumer) -> Vec<String> {
        self.applied
            .lock()
            .unwrap()
            .iter()
            .filter(|(applied, _, _)| *applied == consumer)
            .map(|(_, event_id, _)| event_id.clone())
            .collect()
    }
}

impl EventConsumers for Recorder {
    async fn apply(&self, consumer: Consumer, delivery: &Delivery) -> Result<(), ApplyError> {
        if let Some(outcome) = self.failing.lock().unwrap().get(&consumer) {
            return Err(match outcome {
                Outcome::Retry => {
                    ApplyError::Retry(rootcause::report!("billing is down").into_dynamic())
                }
                Outcome::Reject => {
                    ApplyError::Reject(rootcause::report!("unknown price").into_dynamic())
                }
            });
        }
        let invoice_has_subscription = matches!(
            &delivery.event,
            BillingInboxEvent::Invoice {
                subscription: Some(_),
                ..
            }
        );
        self.applied.lock().unwrap().push((
            consumer,
            delivery.event_id.to_string(),
            delivery.customer_subscriptions.len() + usize::from(invoice_has_subscription) * 100,
        ));
        Ok(())
    }
}

type Inbox = InboxService<PgInbox, FakeStripe, Recorder>;

fn inbox(pool: &PgPool) -> (Inbox, Arc<FakeStripe>, Arc<Recorder>) {
    let stripe = Arc::new(FakeStripe::default());
    let recorder = Arc::new(Recorder::default());
    (
        InboxService::new(
            PgInbox::new(pool.clone()),
            stripe.clone(),
            recorder.clone(),
            false,
        ),
        stripe,
        recorder,
    )
}

fn subscription(id: &str, status: &str, created: i64) -> Value {
    json!({
        "id": id, "object": "subscription", "customer": "cus_Ordered", "status": status,
        "created": created, "currency": "usd", "metadata": {},
        "items": {"has_more": false, "data": [{
            "id": "si_Seat", "quantity": 1,
            "current_period_start": 1_800_000_000, "current_period_end": 1_802_678_400,
            "price": {"id": "price_premium", "product": "prod_Premium", "unit_amount": 4000,
                "currency": "usd", "type": "recurring",
                "recurring": {"interval": "month", "interval_count": 1}}
        }]}
    })
}

fn event(id: &str, event_type: &str, created: i64, object: Value) -> String {
    json!({
        "id": id, "object": "event", "api_version": "2025-09-30.clover", "created": created,
        "livemode": false, "type": event_type, "data": {"object": object}
    })
    .to_string()
}

fn invoice(id: &str, subscription: Option<&str>, purpose: Option<&str>) -> Value {
    json!({
        "id": id, "object": "invoice", "customer": "cus_Ordered", "subscription": subscription,
        "status": "paid", "billing_reason": "subscription_cycle",
        "metadata": purpose.map(|purpose| json!({"macro_purpose": purpose})).unwrap_or(json!({})),
        "lines": {"has_more": false, "data": []}
    })
}

/// Makes every cursor due now, skipping a backoff.
async fn due_now(pool: &PgPool) {
    sqlx::query!("UPDATE stripe_event_cursor SET next_attempt_at = now()")
        .execute(pool)
        .await
        .unwrap();
}

async fn cursor_state(
    pool: &PgPool,
    consumer: Consumer,
) -> (String, i32, Option<String>, Option<String>) {
    let row = sqlx::query!(
        r#"
        SELECT state::text AS "state!", attempts, applied_event_id, dead_event_id
        FROM stripe_event_cursor
        WHERE consumer = ($1::text)::stripe_consumer AND ordering_key = 'cus_Ordered'
        "#,
        consumer.as_ref(),
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (
        row.state,
        row.attempts,
        row.applied_event_id,
        row.dead_event_id,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_redelivered_event_is_stored_and_applied_once(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    let payload = event(
        "evt_Created",
        "customer.subscription.created",
        1_800_000_000,
        subscription("sub_Ordered", "active", 1_800_000_000),
    );

    assert_eq!(inbox.receive(&payload).await.unwrap(), Inserted::New);
    assert_eq!(inbox.receive(&payload).await.unwrap(), Inserted::Duplicate);
    inbox.run_pass().await.unwrap();
    inbox.run_pass().await.unwrap();

    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Created"]
    );
    assert_eq!(recorder.applied(Consumer::Gtm), vec!["evt_Created"]);
    assert_eq!(recorder.applied(Consumer::AiCredits), Vec::<String>::new());
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("idle".to_owned(), 0, Some("evt_Created".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn events_apply_in_created_order_whatever_order_they_arrive_in(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    inbox
        .receive(&event(
            "evt_Later",
            "customer.subscription.updated",
            1_800_000_100,
            subscription("sub_Ordered", "canceled", 1_800_000_000),
        ))
        .await
        .unwrap();
    inbox
        .receive(&event(
            "evt_Earlier",
            "customer.subscription.updated",
            1_800_000_050,
            subscription("sub_Ordered", "past_due", 1_800_000_000),
        ))
        .await
        .unwrap();
    due_now(&pool).await;

    inbox.run_pass().await.unwrap();

    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Earlier", "evt_Later"]
    );
    // The projection holds the newest snapshot, not the last received.
    let snapshot = PgInbox::new(pool.clone())
        .subscription_snapshot(&"sub_Ordered".parse().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(snapshot["status"], "canceled");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_arriving_after_a_later_one_applied_reapplies_from_it_in_order(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    inbox
        .receive(&event(
            "evt_Later",
            "customer.subscription.updated",
            1_800_000_100,
            subscription("sub_Ordered", "canceled", 1_800_000_000),
        ))
        .await
        .unwrap();
    inbox.run_pass().await.unwrap();
    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Later"]
    );

    inbox
        .receive(&event(
            "evt_Earlier",
            "invoice.paid",
            1_800_000_050,
            invoice("in_Late", None, Some("ai_overage")),
        ))
        .await
        .unwrap();
    inbox.run_pass().await.unwrap();

    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Later", "evt_Earlier", "evt_Later"]
    );
    assert_eq!(recorder.applied(Consumer::AiCredits), vec!["evt_Earlier"]);
    // A consumer the late event is not for keeps its place.
    assert_eq!(recorder.applied(Consumer::Computers), vec!["evt_Later"]);
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("idle".to_owned(), 0, Some("evt_Later".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_late_event_during_a_lease_stops_the_holder_from_moving_past_it(pool: PgPool) {
    let (inbox, _, _) = inbox(&pool);
    inbox
        .receive(&event(
            "evt_Later",
            "customer.subscription.updated",
            1_800_000_100,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    let repo = PgInbox::new(pool.clone());
    let replica = Uuid::now_v7();
    let claimed = repo.claim(replica, 100, LEASE).await.unwrap();
    let mut personal = claimed
        .iter()
        .find(|cursor| cursor.consumer == Consumer::PersonalPlan)
        .unwrap()
        .clone();
    let later = Position {
        at: DateTime::from_timestamp(1_800_000_100, 0).unwrap(),
        event_id: "evt_Later".parse().unwrap(),
    };
    assert!(
        repo.advance(&personal, replica, &later, LEASE)
            .await
            .unwrap()
    );
    personal.applied = Some(later.clone());

    // An operator cannot re-arm it while it is leased.
    assert_eq!(
        repo.replay(
            Consumer::PersonalPlan,
            &OrderingKey("cus_Ordered".to_owned()),
            false
        )
        .await
        .unwrap(),
        Replayed::Leased
    );

    inbox
        .receive(&event(
            "evt_Earlier",
            "customer.subscription.updated",
            1_800_000_050,
            subscription("sub_Ordered", "trialing", 1_800_000_000),
        ))
        .await
        .unwrap();
    let next = Position {
        at: DateTime::from_timestamp(1_800_000_200, 0).unwrap(),
        event_id: "evt_Next".parse().unwrap(),
    };
    assert!(
        !repo
            .advance(&personal, replica, &next, LEASE)
            .await
            .unwrap()
    );
    assert!(repo.release(&personal, replica).await.unwrap());
    assert_eq!(
        cursor_state(&pool, Consumer::PersonalPlan).await,
        ("dirty".to_owned(), 0, None, None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_superseded_snapshot_is_skipped_only_by_consumers_of_the_latest(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    for (id, created, status) in [
        ("evt_First", 1_800_000_050, "active"),
        ("evt_Second", 1_800_000_100, "past_due"),
    ] {
        inbox
            .receive(&event(
                id,
                "customer.subscription.updated",
                created,
                subscription("sub_Ordered", status, 1_800_000_000),
            ))
            .await
            .unwrap();
    }
    due_now(&pool).await;

    inbox.run_pass().await.unwrap();

    assert_eq!(recorder.applied(Consumer::Computers), vec!["evt_Second"]);
    assert_eq!(
        recorder.applied(Consumer::PersonalPlan),
        vec!["evt_First", "evt_Second"]
    );
    assert_eq!(
        cursor_state(&pool, Consumer::Computers).await,
        ("idle".to_owned(), 0, Some("evt_Second".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_invoice_paid_twice_applies_once_and_a_later_failure_changes_nothing(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    let overage = invoice("in_Overage", None, Some("ai_overage"));
    inbox
        .receive(&event(
            "evt_Paid",
            "invoice.paid",
            1_800_000_000,
            overage.clone(),
        ))
        .await
        .unwrap();
    inbox
        .receive(&event(
            "evt_Succeeded",
            "invoice.payment_succeeded",
            1_800_000_000,
            overage.clone(),
        ))
        .await
        .unwrap();
    inbox
        .receive(&event(
            "evt_Failed",
            "invoice.payment_failed",
            1_800_000_010,
            overage,
        ))
        .await
        .unwrap();
    due_now(&pool).await;

    inbox.run_pass().await.unwrap();

    assert_eq!(recorder.applied(Consumer::AiCredits), vec!["evt_Paid"]);
    assert_eq!(
        cursor_state(&pool, Consumer::AiCredits).await,
        ("idle".to_owned(), 0, Some("evt_Failed".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_invoice_before_any_subscription_event_reads_the_subscription_once(pool: PgPool) {
    let (inbox, stripe, recorder) = inbox(&pool);
    stripe.subscriptions.lock().unwrap().insert(
        "sub_Ordered".to_owned(),
        subscription("sub_Ordered", "active", 1_800_000_000),
    );
    for id in ["evt_Renewal", "evt_NextRenewal"] {
        inbox
            .receive(&event(
                id,
                "invoice.payment_failed",
                1_800_000_000,
                invoice(&format!("in_{id}"), Some("sub_Ordered"), None),
            ))
            .await
            .unwrap();
    }
    due_now(&pool).await;

    inbox.run_pass().await.unwrap();

    // The two consumers that read it may each read it once on their first
    // apply; after that it is held. The personal plan consumer also lists
    // the customer's subscriptions once.
    let first_reads = stripe.reads.lock().unwrap().clone();
    let subscription_reads = first_reads
        .iter()
        .filter(|read| *read == "subscription sub_Ordered")
        .count();
    assert!((1..=2).contains(&subscription_reads), "{first_reads:?}");
    assert_eq!(
        first_reads
            .iter()
            .filter(|read| *read == "list cus_Ordered")
            .count(),
        1
    );
    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_NextRenewal", "evt_Renewal"]
    );
    assert_eq!(recorder.applied(Consumer::AiCredits), Vec::<String>::new());

    inbox
        .receive(&event(
            "evt_Later",
            "invoice.paid",
            1_800_000_100,
            invoice("in_Later", Some("sub_Ordered"), None),
        ))
        .await
        .unwrap();
    due_now(&pool).await;
    inbox.run_pass().await.unwrap();
    assert_eq!(*stripe.reads.lock().unwrap(), first_reads);
    assert_eq!(
        recorder.applied(Consumer::PersonalPlan),
        vec!["evt_NextRenewal", "evt_Renewal", "evt_Later"]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failing_consumer_backs_off_without_holding_back_the_others(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    recorder
        .failing
        .lock()
        .unwrap()
        .insert(Consumer::TeamSubscription, Outcome::Retry);
    inbox
        .receive(&event(
            "evt_Created",
            "customer.subscription.created",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();

    inbox.run_pass().await.unwrap();

    assert_eq!(
        recorder.applied(Consumer::PersonalPlan),
        vec!["evt_Created"]
    );
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("failing".to_owned(), 1, None, None)
    );
    let backoff = sqlx::query_scalar!(
        r#"
        SELECT next_attempt_at > now() + interval '4 seconds' AS "backed_off!"
        FROM stripe_event_cursor WHERE consumer = 'team_subscription'
        "#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(backoff);

    // Recovered: the retry applies it and resets the attempts.
    recorder.failing.lock().unwrap().clear();
    due_now(&pool).await;
    inbox.run_pass().await.unwrap();
    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Created"]
    );
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("idle".to_owned(), 0, Some("evt_Created".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retries_dead_letter_after_the_attempt_cap(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    recorder
        .failing
        .lock()
        .unwrap()
        .insert(Consumer::TeamSubscription, Outcome::Retry);
    inbox
        .receive(&event(
            "evt_Created",
            "customer.subscription.created",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();

    for _ in 0..MAX_ATTEMPTS {
        due_now(&pool).await;
        inbox.run_pass().await.unwrap();
    }

    let (state, attempts, _, dead_event) = cursor_state(&pool, Consumer::TeamSubscription).await;
    assert_eq!(state, "dead");
    assert_eq!(attempts, i32::try_from(MAX_ATTEMPTS).unwrap());
    assert_eq!(dead_event.as_deref(), Some("evt_Created"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_event_rearms_a_cursor_whose_retries_ran_out(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    recorder
        .failing
        .lock()
        .unwrap()
        .insert(Consumer::TeamSubscription, Outcome::Retry);
    inbox
        .receive(&event(
            "evt_Stuck",
            "customer.subscription.created",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    inbox.run_pass().await.unwrap();
    // Skip to the last attempt.
    sqlx::query!(
        "UPDATE stripe_event_cursor SET attempts = $1, next_attempt_at = now()",
        i32::try_from(MAX_ATTEMPTS - 1).unwrap()
    )
    .execute(&pool)
    .await
    .unwrap();
    inbox.run_pass().await.unwrap();
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        (
            "dead".to_owned(),
            i32::try_from(MAX_ATTEMPTS).unwrap(),
            None,
            Some("evt_Stuck".to_owned())
        )
    );

    // The dependency recovered; the next event re-arms the cursor, which
    // applies from the stuck event.
    recorder.failing.lock().unwrap().clear();
    inbox
        .receive(&event(
            "evt_Next",
            "customer.subscription.updated",
            1_800_000_100,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("dirty".to_owned(), 0, None, None)
    );
    inbox.run_pass().await.unwrap();
    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Stuck", "evt_Next"]
    );
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("idle".to_owned(), 0, Some("evt_Next".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_payload_cleared_by_retention_is_skipped_and_the_cursor_moves_past_it(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    for (id, created) in [("evt_Cleared", 1_800_000_000), ("evt_Kept", 1_800_000_100)] {
        inbox
            .receive(&event(
                id,
                "customer.subscription.updated",
                created,
                subscription("sub_Ordered", "active", 1_800_000_000),
            ))
            .await
            .unwrap();
    }
    sqlx::query!("UPDATE stripe_events SET payload = NULL WHERE id = 'evt_Cleared'")
        .execute(&pool)
        .await
        .unwrap();

    inbox.run_pass().await.unwrap();

    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Kept"]
    );
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("idle".to_owned(), 0, Some("evt_Kept".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_resent_event_older_than_retention_does_not_rewind_the_cursor(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    inbox
        .receive(&event(
            "evt_Current",
            "customer.subscription.updated",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    inbox.run_pass().await.unwrap();

    // A dashboard resend of an event from before the payload retention.
    let resent_at = (Utc::now() - chrono::Duration::days(40)).timestamp();
    assert_eq!(
        inbox
            .receive(&event(
                "evt_Resent",
                "customer.subscription.updated",
                resent_at,
                subscription("sub_Ordered", "past_due", 1_700_000_000),
            ))
            .await
            .unwrap(),
        Inserted::New
    );
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await.2,
        Some("evt_Current".to_owned())
    );
    inbox.run_pass().await.unwrap();

    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        vec!["evt_Current"]
    );
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("idle".to_owned(), 0, Some("evt_Current".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rejected_event_dead_letters_at_once_and_replay_can_skip_it(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    recorder
        .failing
        .lock()
        .unwrap()
        .insert(Consumer::PersonalPlan, Outcome::Reject);
    inbox
        .receive(&event(
            "evt_Bad",
            "customer.subscription.created",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    inbox.run_pass().await.unwrap();
    assert_eq!(
        cursor_state(&pool, Consumer::PersonalPlan).await,
        ("dead".to_owned(), 1, None, Some("evt_Bad".to_owned()))
    );

    // A later event does not re-arm a dead cursor.
    inbox
        .receive(&event(
            "evt_Good",
            "customer.subscription.updated",
            1_800_000_100,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    due_now(&pool).await;
    inbox.run_pass().await.unwrap();
    assert_eq!(
        recorder.applied(Consumer::PersonalPlan),
        Vec::<String>::new()
    );

    recorder.failing.lock().unwrap().clear();
    let key = OrderingKey("cus_Ordered".to_owned());
    assert_eq!(
        inbox
            .replay(Consumer::PersonalPlan, &key, true)
            .await
            .unwrap(),
        Replayed::Rearmed
    );
    inbox.run_pass().await.unwrap();
    assert_eq!(recorder.applied(Consumer::PersonalPlan), vec!["evt_Good"]);
    assert_eq!(
        inbox
            .replay(
                Consumer::PersonalPlan,
                &OrderingKey("cus_Unknown".to_owned()),
                false
            )
            .await
            .unwrap(),
        Replayed::NotFound
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dead_cursors_replay_in_bulk_by_consumer(pool: PgPool) {
    let (inbox, _, recorder) = inbox(&pool);
    for consumer in [Consumer::PersonalPlan, Consumer::TeamSubscription] {
        recorder
            .failing
            .lock()
            .unwrap()
            .insert(consumer, Outcome::Reject);
    }
    inbox
        .receive(&event(
            "evt_Bad",
            "customer.subscription.created",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    inbox.run_pass().await.unwrap();
    assert_eq!(cursor_state(&pool, Consumer::PersonalPlan).await.0, "dead");
    assert_eq!(cursor_state(&pool, Consumer::TeamSubscription).await.0, "dead");

    recorder.failing.lock().unwrap().clear();
    assert_eq!(
        inbox
            .replay_dead(Some(Consumer::PersonalPlan), false, 100)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        cursor_state(&pool, Consumer::PersonalPlan).await,
        ("dirty".to_owned(), 0, None, None)
    );
    assert_eq!(cursor_state(&pool, Consumer::TeamSubscription).await.0, "dead");

    // Skipping moves every remaining dead cursor past its event.
    assert_eq!(inbox.replay_dead(None, true, 100).await.unwrap(), 1);
    assert_eq!(inbox.replay_dead(None, true, 100).await.unwrap(), 0);
    inbox.run_pass().await.unwrap();
    assert_eq!(recorder.applied(Consumer::PersonalPlan), vec!["evt_Bad"]);
    assert_eq!(
        recorder.applied(Consumer::TeamSubscription),
        Vec::<String>::new()
    );
    assert_eq!(
        cursor_state(&pool, Consumer::TeamSubscription).await,
        ("idle".to_owned(), 0, Some("evt_Bad".to_owned()), None)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lease_hides_a_cursor_from_other_replicas_until_it_expires(pool: PgPool) {
    let (inbox, _, _) = inbox(&pool);
    inbox
        .receive(&event(
            "evt_Created",
            "customer.subscription.created",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    let repo = PgInbox::new(pool.clone());
    let first = Uuid::now_v7();
    let second = Uuid::now_v7();

    let claimed = repo.claim(first, 100, LEASE).await.unwrap();
    assert_eq!(claimed.len(), 5);
    assert_eq!(repo.claim(second, 100, LEASE).await.unwrap(), Vec::new());

    // Only the holder can move or release the cursor.
    let position = Position {
        at: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
        event_id: "evt_Created".parse().unwrap(),
    };
    assert!(
        !repo
            .advance(&claimed[0], second, &position, LEASE)
            .await
            .unwrap()
    );
    assert!(
        repo.advance(&claimed[0], first, &position, LEASE)
            .await
            .unwrap()
    );

    // An expired lease is claimed again.
    sqlx::query!("UPDATE stripe_event_cursor SET locked_until = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repo.claim(second, 100, LEASE).await.unwrap().len(), 5);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_received_during_a_lease_keeps_the_cursor_due(pool: PgPool) {
    let (inbox, _, _) = inbox(&pool);
    inbox
        .receive(&event(
            "evt_Created",
            "customer.subscription.created",
            1_800_000_000,
            subscription("sub_Ordered", "active", 1_800_000_000),
        ))
        .await
        .unwrap();
    let repo = PgInbox::new(pool.clone());
    let replica = Uuid::now_v7();
    let claimed = repo.claim(replica, 100, LEASE).await.unwrap();
    let gtm = claimed
        .iter()
        .find(|cursor| cursor.consumer == Consumer::Gtm)
        .unwrap()
        .clone();

    inbox
        .receive(&event(
            "evt_Updated",
            "customer.subscription.updated",
            1_800_000_100,
            subscription("sub_Ordered", "canceled", 1_800_000_000),
        ))
        .await
        .unwrap();
    assert!(repo.release(&gtm, replica).await.unwrap());

    assert_eq!(cursor_state(&pool, Consumer::Gtm).await.0, "dirty");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_mode_event_is_refused_by_a_test_deployment(pool: PgPool) {
    let (inbox, _, _) = inbox(&pool);
    let payload = json!({
        "id": "evt_Live", "object": "event", "api_version": "2025-09-30.clover",
        "created": 1_800_000_000, "livemode": true, "type": "customer.subscription.created",
        "data": {"object": subscription("sub_Ordered", "active", 1_800_000_000)}
    })
    .to_string();

    let refused = inbox.receive(&payload).await.unwrap_err();

    assert!(matches!(
        refused,
        crate::domain::service::ReceiveError::WrongMode
    ));
}
