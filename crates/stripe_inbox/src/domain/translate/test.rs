use std::str::FromStr;

use chrono::DateTime;
use serde_json::json;

use super::*;
use crate::domain::model::{PeriodProof, SubscriptionEventKind};

const CLOVER_SUBSCRIPTION_UPDATED: &str =
    include_str!("../../../fixtures/clover_subscription_updated.json");
const V2019_SUBSCRIPTION_UPDATED: &str =
    include_str!("../../../fixtures/v2019_subscription_updated.json");
const CLOVER_TEAM_SUBSCRIPTION_CREATED: &str =
    include_str!("../../../fixtures/clover_team_subscription_created.json");
const CLOVER_INVOICE_PAID: &str = include_str!("../../../fixtures/clover_invoice_paid.json");
const V2019_INVOICE_PAYMENT_SUCCEEDED: &str =
    include_str!("../../../fixtures/v2019_invoice_payment_succeeded.json");
const CLOVER_OVERAGE_FAILED: &str =
    include_str!("../../../fixtures/clover_invoice_payment_failed_overage.json");
const CLOVER_CHECKOUT_COMPLETED: &str =
    include_str!("../../../fixtures/clover_checkout_completed.json");
const CLOVER_CUSTOMER_DELETED: &str =
    include_str!("../../../fixtures/clover_customer_deleted.json");

fn stored(payload: &str) -> (EventType, Value) {
    let event = received_event(payload).unwrap();
    (event.event_type().unwrap(), event.payload)
}

fn subscription_change(payload: &str) -> SubscriptionChange {
    let (event_type, payload) = stored(payload);
    match translate(event_type, &payload).unwrap() {
        Translated::Subscription(change) => change,
        other => panic!("expected a subscription, got {other:?}"),
    }
}

fn invoice(payload: &str) -> InvoiceFacts {
    let (event_type, payload) = stored(payload);
    match translate(event_type, &payload).unwrap() {
        Translated::Invoice(invoice) => invoice,
        other => panic!("expected an invoice, got {other:?}"),
    }
}

#[test]
fn received_subscription_event_is_ordered_by_customer_and_projected() {
    let event = received_event(CLOVER_TEAM_SUBSCRIPTION_CREATED).unwrap();

    assert_eq!(event.id.as_str(), "evt_1TeamCreated");
    assert_eq!(
        event.event_type(),
        Some(EventType::CustomerSubscriptionCreated)
    );
    assert_eq!(event.api_version, "2025-09-30.clover");
    assert_eq!(
        event.created_at,
        DateTime::from_timestamp(1_800_000_000, 0).unwrap()
    );
    // An expanded customer object orders by its id.
    assert_eq!(event.ordering_key, OrderingKey("cus_Owner".to_owned()));
    assert_eq!(event.object_id, "sub_1Team");
    let projection = event.projection.unwrap();
    assert_eq!(projection.kind, ObjectKind::Subscription);
    assert_eq!(projection.id, "sub_1Team");
    assert_eq!(projection.customer.as_deref(), Some("cus_Owner"));
    assert!(!projection.deleted);
}

#[test]
fn received_customer_deletion_is_projected_as_deleted() {
    let event = received_event(CLOVER_CUSTOMER_DELETED).unwrap();

    assert_eq!(event.ordering_key, OrderingKey("cus_Gone".to_owned()));
    let projection = event.projection.unwrap();
    assert_eq!(projection.kind, ObjectKind::Customer);
    assert!(projection.deleted);
    let facts = customer_facts(&projection.snapshot, projection.deleted).unwrap();
    assert!(facts.deleted);
    assert_eq!(facts.email.as_deref(), Some("gone@example.com"));
}

#[test]
fn an_event_without_a_customer_is_ordered_by_its_object() {
    let event = received_event(CLOVER_CHECKOUT_COMPLETED).unwrap();

    assert_eq!(
        event.ordering_key,
        OrderingKey("cs_test_Credits".to_owned())
    );
    assert_eq!(event.projection, None);
}

#[test]
fn unknown_event_types_are_still_received() {
    let payload = json!({
        "id": "evt_1Unknown", "object": "event", "api_version": "2025-09-30.clover",
        "created": 1_800_000_000, "livemode": true, "type": "charge.refunded",
        "data": {"object": {"id": "ch_1", "object": "charge", "customer": "cus_Personal"}}
    })
    .to_string();

    let event = received_event(&payload).unwrap();

    assert_eq!(event.event_type(), None);
    assert_eq!(event.type_name, "charge.refunded");
    assert!(event.livemode);
    assert_eq!(event.ordering_key, OrderingKey("cus_Personal".to_owned()));
}

#[test]
fn both_api_versions_translate_to_the_same_subscription_facts() {
    let clover = subscription_change(CLOVER_SUBSCRIPTION_UPDATED);
    let v2019 = subscription_change(V2019_SUBSCRIPTION_UPDATED);

    assert_eq!(clover.subscription, v2019.subscription);
    let subscription = clover.subscription;
    assert_eq!(subscription.id.as_str(), "sub_1Personal");
    assert_eq!(subscription.customer.as_str(), "cus_Personal");
    assert_eq!(subscription.status, SubscriptionStatus::Active);
    assert_eq!(subscription.team_id, None);
    assert_eq!(
        subscription.attribution.ga_client_id.as_deref(),
        Some("GA1.2.3")
    );
    assert_eq!(subscription.attribution.fbc, None);
    assert_eq!(
        subscription.plan_change_at,
        Some(
            DateTime::parse_from_rfc3339("2027-01-15T08:00:10.123456Z")
                .unwrap()
                .to_utc()
        )
    );
    assert!(subscription.items_complete);
    assert_eq!(
        subscription.items,
        vec![ItemFacts {
            id: SubscriptionItemId::from_str("si_Seat").unwrap(),
            price: PriceId::from_str("price_max").unwrap(),
            product: Some(ProductId::from_str("prod_Max").unwrap()),
            unit_amount: Some(20_000),
            currency: Some("usd".to_owned()),
            monthly: true,
            quantity: Some(1),
            period: Some(Period {
                start: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
                end: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
            }),
            computer_id: None,
        }]
    );
    assert_eq!(subscription.value_cents(), Some(20_000));
}

#[test]
fn previous_attributes_carry_the_old_price_and_the_plan_change_stamp() {
    let change = subscription_change(CLOVER_SUBSCRIPTION_UPDATED);

    assert_eq!(change.kind, SubscriptionEventKind::Updated);
    assert!(change.previous.plan_change_stamped);
    assert_eq!(change.previous.status, None);
    let items = change.previous.items.clone().unwrap();
    assert_eq!(items[0].id.as_str(), "si_Seat");
    assert_eq!(
        items[0].price.as_ref().map(PriceId::as_str),
        Some("price_premium")
    );
    assert!(!change.is_new());
    assert!(!change.started_trial());
}

#[test]
fn a_team_subscription_carries_its_team_owner_and_computers() {
    let change = subscription_change(CLOVER_TEAM_SUBSCRIPTION_CREATED);
    let subscription = &change.subscription;

    assert_eq!(
        subscription.team_id,
        Some(Uuid::parse_str("0195d6b1-7a8f-7c3e-9a51-2a2b3c4d5e6f").unwrap())
    );
    assert_eq!(
        subscription
            .owner_id
            .as_ref()
            .map(|owner| owner.as_ref().to_owned()),
        Some("macro|owner@example.com".to_owned())
    );
    // `has_more` means a snapshot left items out.
    assert!(!subscription.items_complete);
    assert_eq!(
        subscription.items[1].computer_id,
        Some(Uuid::parse_str("0195d6b1-7a8f-7c3e-9a51-000000000001").unwrap())
    );
    assert_eq!(subscription.value_cents(), Some(17_000));
    assert!(change.is_new());
    assert!(change.started_trial());
}

#[test]
fn an_invalid_team_id_fails_translation() {
    let mut payload: Value = serde_json::from_str(CLOVER_TEAM_SUBSCRIPTION_CREATED).unwrap();
    payload["data"]["object"]["metadata"]["team_id"] = json!("not-a-team");

    let error = translate(EventType::CustomerSubscriptionCreated, &payload).unwrap_err();

    assert!(matches!(
        error,
        TranslateError::Invalid("subscription team_id metadata")
    ));
}

#[test]
fn an_item_with_one_period_boundary_has_no_period() {
    let mut payload: Value = serde_json::from_str(CLOVER_SUBSCRIPTION_UPDATED).unwrap();
    payload["data"]["object"]["items"]["data"][0]
        .as_object_mut()
        .unwrap()
        .remove("current_period_end");
    // An item boundary wins over a subscription-level period.
    payload["data"]["object"]["current_period_start"] = json!(1_800_000_000);
    payload["data"]["object"]["current_period_end"] = json!(1_802_678_400);

    let Translated::Subscription(change) =
        translate(EventType::CustomerSubscriptionUpdated, &payload).unwrap()
    else {
        panic!("expected a subscription");
    };

    assert_eq!(change.subscription.items[0].period, None);
}

#[test]
fn an_unsupported_api_version_fails_loudly() {
    let mut payload: Value = serde_json::from_str(CLOVER_SUBSCRIPTION_UPDATED).unwrap();
    payload["api_version"] = json!("2030-01-01.future");

    let error = translate(EventType::CustomerSubscriptionUpdated, &payload).unwrap_err();

    assert!(
        matches!(error, TranslateError::UnsupportedApiVersion(version) if version == "2030-01-01.future")
    );
}

#[test]
fn both_api_versions_translate_to_the_same_invoice_facts() {
    let clover = invoice(CLOVER_INVOICE_PAID);
    let v2019 = invoice(V2019_INVOICE_PAYMENT_SUCCEEDED);

    assert_eq!(clover, v2019);
    assert_eq!(clover.id.as_str(), "in_1Renewal");
    assert_eq!(
        clover.subscription.as_ref().map(SubscriptionId::as_str),
        Some("sub_1Personal")
    );
    assert!(clover.paid);
    assert!(clover.lines_complete);
    assert_eq!(
        clover.lines,
        vec![InvoiceLine {
            item: Some(SubscriptionItemId::from_str("si_Seat").unwrap()),
            price: Some(PriceId::from_str("price_max").unwrap()),
            proration: Some(false),
            period: Some(Period {
                start: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
                end: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
            }),
        }]
    );
}

#[test]
fn a_paid_cycle_invoice_proves_the_renewal_of_its_matching_item_only() {
    let subscription = subscription_change(CLOVER_SUBSCRIPTION_UPDATED).subscription;
    let item = &subscription.items[0];
    let paid = invoice(CLOVER_INVOICE_PAID);

    assert_eq!(paid.period_proof(&subscription, item), PeriodProof::Renewal);

    let mut wrong = vec![paid.clone(); 6];
    wrong[0].billing_reason = Some("subscription_update".to_owned());
    wrong[1].lines[0].proration = Some(true);
    wrong[2].lines[0].period = None;
    wrong[3].lines[0].item = Some(SubscriptionItemId::from_str("si_Other").unwrap());
    wrong[4].status = Some("open".to_owned());
    wrong[5].lines_complete = false;
    for invoice in wrong {
        assert_eq!(
            invoice.period_proof(&subscription, item),
            PeriodProof::Snapshot
        );
    }

    let mut created = paid;
    created.billing_reason = Some("subscription_create".to_owned());
    assert_eq!(
        created.period_proof(&subscription, item),
        PeriodProof::Initial
    );
}

#[test]
fn a_failed_overage_invoice_has_no_subscription_and_keeps_its_purpose() {
    let failed = invoice(CLOVER_OVERAGE_FAILED);

    assert!(!failed.paid);
    assert_eq!(failed.subscription, None);
    assert_eq!(
        failed.metadata.get("macro_purpose").map(String::as_str),
        Some("ai_overage")
    );
}

#[test]
fn a_checkout_session_translates_its_payment_and_metadata() {
    let (event_type, payload) = stored(CLOVER_CHECKOUT_COMPLETED);
    let Translated::Checkout(checkout) = translate(event_type, &payload).unwrap() else {
        panic!("expected a checkout");
    };

    assert_eq!(checkout.id.as_str(), "cs_test_Credits");
    assert!(checkout.paid);
    assert_eq!(checkout.amount_total, Some(2500));
    assert_eq!(
        checkout.metadata.get("macro_user_id").map(String::as_str),
        Some("macro|buyer@example.com")
    );
}

#[test]
fn api_read_items_take_the_subscription_period_when_they_carry_none() {
    let period = Period {
        start: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
        end: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
    };
    let items = vec![json!({
        "id": "si_Computer", "quantity": 1, "metadata": {},
        "price": {"id": "price_computer", "metadata": {"computer_id": "0195d6b1-7a8f-7c3e-9a51-000000000001"}}
    })];

    let facts = subscription_items(&items, Some(period)).unwrap();

    assert_eq!(facts[0].period, Some(period));
    assert_eq!(
        facts[0].computer_id,
        Some(Uuid::parse_str("0195d6b1-7a8f-7c3e-9a51-000000000001").unwrap())
    );
}
