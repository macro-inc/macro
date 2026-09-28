use super::*;
use serde_json::json;

fn subscription() -> Value {
    json!({
        "id": "sub_verified", "created": 1_700_000_000, "customer": "cus_verified",
        "status": "active", "metadata": {}, "current_period_start": 1_800_000_000,
        "current_period_end": 1_802_678_400,
        "items": {"has_more": false, "data": [{"id": "si_verified", "quantity": 1,
            "price": {"id": "price_40", "product": "prod_40", "unit_amount": 4000,
            "currency": "usd", "type": "recurring", "recurring": {"interval": "month", "interval_count": 1}}}]}
    })
}

fn invoice() -> Value {
    json!({
        "subscription": "sub_verified", "customer": "cus_verified", "status": "paid",
        "billing_reason": "subscription_cycle", "amount_paid": 0,
        "lines": {"has_more": false, "data": [{"subscription_item": "si_verified",
            "price": {"id": "price_40"}, "proration": false,
            "period": {"start": 1_800_000_000, "end": 1_802_678_400}}]}
    })
}

fn event(object: Value) -> BillingEvent {
    BillingEvent {
        id: "evt_paid".into(),
        at: DateTime::from_timestamp(1_800_000_010, 0).unwrap(),
        object,
    }
}

#[test]
fn supports_both_period_versions_without_fallback() {
    let old = subscription();
    let mut new = old.clone();
    new["items"]["data"][0]["current_period_start"] = new["current_period_start"].take();
    new["items"]["data"][0]["current_period_end"] = new["current_period_end"].take();
    let event = event(invoice());
    assert_eq!(
        subscription_periods(&event, &old, None),
        subscription_periods(&event, &new, None)
    );
    new["items"]["data"][0]
        .as_object_mut()
        .unwrap()
        .remove("current_period_end");
    assert!(subscription_periods(&event, &new, None).is_empty());
}

#[test]
fn discounted_paid_renewal_uses_price_not_invoice_total() {
    let invoice = invoice();
    let event = event(invoice.clone());
    let facts = subscription_periods(&event, &subscription(), Some(&invoice));
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].evidence, PeriodEvidence::Renewal);
    assert_eq!(facts[0].unit_amount, Some(4000));
    assert_eq!(facts[0].product_id.as_str(), "prod_40");
}

#[test]
fn ordinary_updates_and_wrong_or_delayed_invoice_lines_never_prove_renewal() {
    let sub = subscription();
    let event = event(invoice());
    assert_eq!(
        subscription_periods(&event, &sub, None)[0].evidence,
        PeriodEvidence::Snapshot
    );
    let mut invoices = vec![invoice(); 7];
    invoices[0]["billing_reason"] = json!("subscription_update");
    invoices[1]["lines"]["data"][0]["proration"] = json!(true);
    invoices[2]["lines"]["data"][0]["period"]["start"] = json!(1_700_000_000);
    invoices[3]["lines"]["data"][0]["subscription_item"] = json!("si_other");
    invoices[4]["status"] = json!("open");
    invoices[5]["customer"] = json!("cus_other");
    invoices[6]["lines"]["has_more"] = json!(true);
    for invoice in invoices {
        assert_eq!(
            subscription_periods(&event, &sub, Some(&invoice))[0].evidence,
            PeriodEvidence::Snapshot
        );
    }
}

#[test]
fn unknown_recurrence_is_not_assumed_monthly() {
    let mut sub = subscription();
    sub["items"]["data"][0]["price"]["recurring"] = Value::Null;
    let facts = subscription_periods(&event(invoice()), &sub, None);
    assert!(!facts[0].monthly);
}

#[test]
fn newer_invoice_parent_fields_are_matched_by_item_and_price() {
    let mut invoice = invoice();
    invoice["parent"]["subscription_details"]["subscription"] = invoice["subscription"].take();
    let line = &mut invoice["lines"]["data"][0];
    line["parent"]["subscription_item_details"] =
        json!({"subscription_item": "si_verified", "proration": false});
    line["pricing"]["price_details"]["price"] = json!("price_40");
    for key in ["subscription_item", "price", "proration"] {
        line.as_object_mut().unwrap().remove(key);
    }
    assert_eq!(
        subscription_periods(&event(invoice.clone()), &subscription(), Some(&invoice))[0].evidence,
        PeriodEvidence::Renewal
    );
}
