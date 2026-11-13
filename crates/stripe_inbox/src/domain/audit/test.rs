use std::sync::Mutex;

use serde_json::{Value, json};
use stripe::CustomerId;

use super::*;
use crate::domain::model::Consumer;
use crate::domain::ports::{Page, StripeReadError};

#[derive(Debug, thiserror::Error)]
#[error("unused")]
struct Never;

/// The audit's storage in memory: two stored events and one held snapshot.
#[derive(Clone, Default)]
struct Held {
    recorded: Arc<Mutex<Vec<Mismatch>>>,
    finished: Arc<Mutex<bool>>,
}

fn subscription(id: &str, status: &str, price: &str) -> Value {
    json!({
        "id": id, "object": "subscription", "customer": "cus_Audited", "status": status,
        "created": 1_700_000_000, "metadata": {},
        "items": {"has_more": false, "data": [
            {"id": "si_Seat", "quantity": 1, "price": {"id": price}}
        ]}
    })
}

impl AuditRepo for Held {
    type Err = Never;

    async fn claim_run(
        &self,
        _replica: Uuid,
        _interval: chrono::Duration,
        _lease: chrono::Duration,
    ) -> Result<Option<Uuid>, Never> {
        Ok(Some(Uuid::now_v7()))
    }

    async fn finish_run(&self, _replica: Uuid) -> Result<(), Never> {
        *self.finished.lock().unwrap() = true;
        Ok(())
    }

    async fn stored_event_ids(&self, ids: &[EventId]) -> Result<Vec<EventId>, Never> {
        Ok(ids
            .iter()
            .filter(|id| id.as_str() == "evt_Stored")
            .cloned()
            .collect())
    }

    async fn received_types(&self, _since: DateTime<Utc>) -> Result<Vec<String>, Never> {
        Ok(vec![
            "invoice.paid".to_owned(),
            "charge.refunded".to_owned(),
        ])
    }

    async fn subscription_snapshots(
        &self,
        ids: &[SubscriptionId],
    ) -> Result<Vec<(Value, DateTime<Utc>)>, Never> {
        let observed = Utc::now() - chrono::Duration::hours(1);
        Ok(ids
            .iter()
            .filter_map(|id| match id.as_str() {
                "sub_Drifted" => Some((
                    subscription("sub_Drifted", "active", "price_premium"),
                    observed,
                )),
                "sub_Current" => Some((
                    subscription("sub_Current", "active", "price_premium"),
                    observed,
                )),
                _ => None,
            })
            .collect())
    }

    async fn dead_cursors(&self) -> Result<Vec<(Consumer, u64)>, Never> {
        Ok(Vec::new())
    }

    async fn last_invoice_failed(&self, _customer: &CustomerId) -> Result<bool, Never> {
        Ok(false)
    }

    async fn record(&self, _run_id: Uuid, mismatches: &[Mismatch]) -> Result<(), Never> {
        self.recorded.lock().unwrap().extend_from_slice(mismatches);
        Ok(())
    }

    async fn apply_retention(
        &self,
        _clear_before: DateTime<Utc>,
        _delete_before: DateTime<Utc>,
    ) -> Result<(), Never> {
        Ok(())
    }
}

/// Stripe with three events and two subscriptions, each on two pages.
struct Listed;

impl StripeReader for Listed {
    async fn retrieve_subscription(&self, _id: &SubscriptionId) -> Result<Value, StripeReadError> {
        Err(StripeReadError::RateLimited)
    }

    async fn subscription_items(
        &self,
        _id: &SubscriptionId,
    ) -> Result<Vec<Value>, StripeReadError> {
        Err(StripeReadError::RateLimited)
    }

    async fn customer_subscriptions(
        &self,
        _customer: &CustomerId,
    ) -> Result<Vec<Value>, StripeReadError> {
        Err(StripeReadError::RateLimited)
    }

    async fn retrieve_customer(&self, _customer: &CustomerId) -> Result<Value, StripeReadError> {
        Err(StripeReadError::RateLimited)
    }

    async fn events(
        &self,
        _since: DateTime<Utc>,
        starting_after: Option<&EventId>,
    ) -> Result<Page, StripeReadError> {
        let old = (Utc::now() - chrono::Duration::hours(2)).timestamp();
        let fresh = Utc::now().timestamp();
        Ok(match starting_after {
            None => Page {
                data: vec![
                    json!({"id": "evt_Stored", "type": "invoice.paid", "created": old}),
                    json!({"id": "evt_InFlight", "type": "invoice.paid", "created": fresh}),
                    // The webhook is not sent types no consumer applies.
                    json!({"id": "evt_Unsent", "type": "payment_intent.succeeded", "created": old}),
                ],
                has_more: true,
            },
            Some(_) => Page {
                data: vec![
                    json!({"id": "evt_Lost", "type": "customer.subscription.updated", "created": old}),
                ],
                has_more: false,
            },
        })
    }

    async fn subscriptions(
        &self,
        starting_after: Option<&SubscriptionId>,
    ) -> Result<Page, StripeReadError> {
        Ok(match starting_after.map(SubscriptionId::as_str) {
            None => Page {
                data: vec![subscription("sub_Drifted", "canceled", "price_premium")],
                has_more: true,
            },
            // A page of subscriptions the translator cannot read does not
            // end the sweep.
            Some("sub_Drifted") => Page {
                data: vec![json!({"id": "sub_Unreadable", "object": "subscription"})],
                has_more: true,
            },
            Some(_) => Page {
                data: vec![subscription("sub_Current", "active", "price_premium")],
                has_more: false,
            },
        })
    }
}

/// Domain state that disagrees about one subscription.
struct Domains;

impl DomainAudit for Domains {
    async fn check(
        &self,
        subscription: &SubscriptionFacts,
        _last_invoice_failed: bool,
    ) -> Result<Vec<Mismatch>, rootcause::Report> {
        Ok(if subscription.id.as_str() == "sub_Current" {
            vec![Mismatch {
                kind: MismatchKind::TeamBilling,
                object_id: "sub_Current".to_owned(),
                stripe_value: None,
                macro_value: None,
            }]
        } else {
            Vec::new()
        })
    }
}

#[tokio::test]
async fn the_audit_records_missing_events_unconsumed_types_drift_and_domain_findings() {
    let held = Held::default();
    let audit = AuditService::new(held.clone(), Arc::new(Listed), Arc::new(Domains));

    let report = audit.run_if_due().await.unwrap().unwrap();

    assert_eq!(report.events, 4);
    assert_eq!(report.subscriptions, 2);
    let recorded: Vec<(MismatchKind, String)> = held
        .recorded
        .lock()
        .unwrap()
        .iter()
        .map(|mismatch| (mismatch.kind, mismatch.object_id.clone()))
        .collect();
    assert_eq!(
        recorded,
        vec![
            // Stored and in-flight events are not missing.
            (MismatchKind::MissingEvent, "evt_Lost".to_owned()),
            (
                MismatchKind::UnconsumedEventType,
                "charge.refunded".to_owned()
            ),
            (MismatchKind::StaleSnapshot, "sub_Drifted".to_owned()),
            (MismatchKind::TeamBilling, "sub_Current".to_owned()),
        ]
    );
    assert_eq!(report.mismatches, 4);
    assert!(*held.finished.lock().unwrap());
}

#[test]
fn snapshot_drift_compares_status_and_item_prices() {
    let held =
        translate::subscription_facts(&subscription("sub_A", "active", "price_premium")).unwrap();
    let same = held.clone();
    let canceled =
        translate::subscription_facts(&subscription("sub_A", "canceled", "price_premium")).unwrap();
    let upgraded =
        translate::subscription_facts(&subscription("sub_A", "active", "price_max")).unwrap();

    assert!(!snapshot_drifted(&same, &held));
    assert!(snapshot_drifted(&canceled, &held));
    assert!(snapshot_drifted(&upgraded, &held));
}

#[test]
fn snapshot_drift_compares_the_items_both_sides_show_when_a_list_is_incomplete() {
    let held =
        translate::subscription_facts(&subscription("sub_A", "active", "price_premium")).unwrap();
    let mut repriced =
        translate::subscription_facts(&subscription("sub_A", "active", "price_max")).unwrap();
    repriced.items_complete = false;
    let mut more_items = held.clone();
    more_items.items_complete = false;
    more_items.items.clear();

    assert!(snapshot_drifted(&repriced, &held));
    // A partial list is no evidence an item is gone.
    assert!(!snapshot_drifted(&more_items, &held));
}
