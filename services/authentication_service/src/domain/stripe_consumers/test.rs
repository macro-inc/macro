use serde_json::{Value, json};
use stripe_inbox::domain::model::EventType;
use stripe_inbox::domain::translate::{self, Translated};

use super::*;

const TEAM: &str = "0195d6b1-7a8f-7c3e-9a51-2a2b3c4d5e6f";

/// Historical prices Macro still bills subscribers at.
const MACRO_WEB_PRICE: &str = "price_1PnRu9JaD7zvQeOBbExpFxPX";
const PROFESSIONAL_PRICE: &str = "price_1KnR08JaD7zvQeOB7S30pQ0C";
/// A price neither sold nor on the legacy list.
const UNLISTED_PRICE: &str = "price_1ZzUnlistedJaD7zvQeOBzzzz";

fn prices() -> SeatPrices {
    SeatPrices {
        premium: "price_premium".parse().unwrap(),
        max: Some("price_max".parse().unwrap()),
    }
}

fn event_id() -> EventId {
    "evt_Decided".parse().unwrap()
}

fn event_at() -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_010, 0).unwrap()
}

fn subscription(id: &str, status: &str, created: i64, price: &str) -> Value {
    json!({
        "id": id, "object": "subscription", "customer": "cus_Person", "status": status,
        "created": created, "currency": "usd", "metadata": {},
        "items": {"has_more": false, "data": [{
            "id": "si_Seat", "quantity": 1,
            "current_period_start": 1_800_000_000, "current_period_end": 1_802_678_400,
            "price": {"id": price, "product": "prod_Seat", "unit_amount": 4000, "currency": "usd",
                "type": "recurring", "recurring": {"interval": "month", "interval_count": 1}}
        }]}
    })
}

fn change(event_type: EventType, object: Value, previous: Value) -> SubscriptionChange {
    let payload = json!({
        "id": "evt_Decided", "api_version": "2025-09-30.clover", "created": 1_800_000_010,
        "livemode": false, "type": event_type.as_ref(),
        "data": {"object": object, "previous_attributes": previous}
    });
    match translate::translate(event_type, &payload).unwrap() {
        Translated::Subscription(change) => change,
        other => panic!("expected a subscription, got {other:?}"),
    }
}

fn facts(object: Value) -> SubscriptionFacts {
    translate::subscription_facts(&object).unwrap()
}

fn invoice(paid: bool, billing_reason: &str) -> InvoiceFacts {
    let payload = json!({
        "id": "evt_Decided", "api_version": "2025-09-30.clover", "created": 1_800_000_010,
        "livemode": false, "type": if paid { "invoice.paid" } else { "invoice.payment_failed" },
        "data": {"object": {
            "id": "in_Renewal", "customer": "cus_Person", "subscription": "sub_Person",
            "status": if paid { "paid" } else { "open" }, "billing_reason": billing_reason,
            "lines": {"has_more": false, "data": [{
                "subscription_item": "si_Seat", "price": "price_premium", "proration": false,
                "period": {"start": 1_800_000_000, "end": 1_802_678_400}
            }]}
        }}
    });
    let event_type = if paid {
        EventType::InvoicePaid
    } else {
        EventType::InvoicePaymentFailed
    };
    match translate::translate(event_type, &payload).unwrap() {
        Translated::Invoice(invoice) => invoice,
        other => panic!("expected an invoice, got {other:?}"),
    }
}

#[test]
fn a_new_trial_grants_premium_and_records_the_trial() {
    let created = change(
        EventType::CustomerSubscriptionCreated,
        subscription("sub_Person", "trialing", 1_800_000_000, "price_premium"),
        Value::Null,
    );

    let decision = decide_personal_subscription(
        &event_id(),
        event_at(),
        &created,
        std::slice::from_ref(&created.subscription),
        &prices(),
    )
    .unwrap();

    let PersonalDecision::Apply(update) = decision else {
        panic!("expected an update, got {decision:?}");
    };
    assert_eq!(update.access, PersonalAccess::Grant(ProductTier::Opus));
    assert!(update.started_trial);
    assert_eq!(update.verified.len(), 1);
    assert_eq!(update.verified[0].evidence, PeriodEvidence::Snapshot);
    assert_eq!(update.verified[0].activity, SubscriptionActivity::Trialing);
    let plan_change = update.plan_change.unwrap();
    assert_eq!(
        (plan_change.from, plan_change.to),
        (PlanTier::Free, PlanTier::Premium)
    );
    assert_eq!(plan_change.at, event_at());
}

#[test]
fn the_newer_of_two_live_subscriptions_is_canceled_and_the_oldest_kept() {
    let older = facts(subscription(
        "sub_Older",
        "active",
        1_700_000_000,
        "price_premium",
    ));
    let newer = change(
        EventType::CustomerSubscriptionCreated,
        subscription("sub_Newer", "active", 1_800_000_000, "price_premium"),
        Value::Null,
    );
    let customer = [older.clone(), newer.subscription.clone()];

    assert_eq!(
        decide_personal_subscription(&event_id(), event_at(), &newer, &customer, &prices())
            .unwrap(),
        PersonalDecision::CancelDuplicate
    );

    let older_update = change(
        EventType::CustomerSubscriptionUpdated,
        subscription("sub_Older", "active", 1_700_000_000, "price_premium"),
        Value::Null,
    );
    assert!(matches!(
        decide_personal_subscription(&event_id(), event_at(), &older_update, &customer, &prices())
            .unwrap(),
        PersonalDecision::Apply(_)
    ));
}

#[test]
fn canceling_one_subscription_keeps_access_while_another_is_live() {
    let canceled = change(
        EventType::CustomerSubscriptionDeleted,
        subscription("sub_Person", "canceled", 1_700_000_000, "price_premium"),
        Value::Null,
    );
    let other = facts(subscription(
        "sub_Other",
        "active",
        1_800_000_000,
        "price_premium",
    ));

    assert_eq!(
        decide_personal_subscription(
            &event_id(),
            event_at(),
            &canceled,
            &[canceled.subscription.clone(), other],
            &prices(),
        )
        .unwrap(),
        PersonalDecision::KeepAccess
    );

    let PersonalDecision::Apply(update) = decide_personal_subscription(
        &event_id(),
        event_at(),
        &canceled,
        std::slice::from_ref(&canceled.subscription),
        &prices(),
    )
    .unwrap() else {
        panic!("expected a revoke");
    };
    assert_eq!(
        update.access,
        PersonalAccess::Revoke {
            status: RoleStatus::Canceled,
            tier: ProductTier::Opus
        }
    );
    assert_eq!(update.plan_change, None);
}

#[test]
fn an_unknown_price_grants_nothing_and_fails() {
    let unknown = change(
        EventType::CustomerSubscriptionCreated,
        subscription("sub_Person", "active", 1_800_000_000, UNLISTED_PRICE),
        Value::Null,
    );

    assert_eq!(
        decide_personal_subscription(
            &event_id(),
            event_at(),
            &unknown,
            std::slice::from_ref(&unknown.subscription),
            &prices()
        ),
        Err(UnknownPrice {
            subscription_id: "sub_Person".to_owned()
        })
    );
}

#[test]
fn incomplete_and_team_subscriptions_are_not_personal_plans() {
    let incomplete = change(
        EventType::CustomerSubscriptionCreated,
        subscription("sub_Person", "incomplete", 1_800_000_000, "price_premium"),
        Value::Null,
    );
    let mut team_object = subscription("sub_Team", "active", 1_800_000_000, "price_premium");
    team_object["metadata"]["team_id"] = json!(TEAM);
    let team = change(
        EventType::CustomerSubscriptionCreated,
        team_object,
        Value::Null,
    );

    for ignored in [incomplete, team] {
        assert_eq!(
            decide_personal_subscription(&event_id(), event_at(), &ignored, &[], &prices())
                .unwrap(),
            PersonalDecision::Ignore
        );
    }
}

#[test]
fn an_upgrade_records_macros_own_change_time() {
    let mut object = subscription("sub_Person", "active", 1_700_000_000, "price_max");
    object["metadata"]["macro_plan_change_at"] = json!("2027-01-15T08:00:10.123456Z");
    let upgraded = change(
        EventType::CustomerSubscriptionUpdated,
        object,
        json!({
            "items": {"data": [{"id": "si_Seat", "price": {"id": "price_premium"}}]},
            "metadata": {"macro_plan_change_at": null}
        }),
    );

    let plan_change = personal_plan_change(&upgraded, event_at(), &prices()).unwrap();

    assert_eq!(
        (plan_change.from, plan_change.to),
        (PlanTier::Premium, PlanTier::Max)
    );
    assert_eq!(
        plan_change.at,
        DateTime::parse_from_rfc3339("2027-01-15T08:00:10.123456Z")
            .unwrap()
            .to_utc()
    );
}

#[test]
fn a_stamp_this_update_did_not_set_is_not_reused() {
    let mut object = subscription("sub_Person", "active", 1_700_000_000, "price_max");
    object["metadata"]["macro_plan_change_at"] = json!("2026-01-15T08:00:10Z");
    let portal_edit = change(
        EventType::CustomerSubscriptionUpdated,
        object,
        json!({"items": {"data": [{"id": "si_Seat", "price": {"id": "price_premium"}}]}}),
    );

    assert_eq!(
        personal_plan_change(&portal_edit, event_at(), &prices())
            .unwrap()
            .at,
        event_at()
    );
}

#[test]
fn a_renewal_downgrade_belongs_to_the_new_period() {
    let downgraded = change(
        EventType::CustomerSubscriptionUpdated,
        subscription("sub_Person", "active", 1_700_000_000, "price_premium"),
        json!({
            "items": {"data": [{"id": "si_Seat", "price": {"id": "price_max"}, "current_period_start": 1_797_321_600}]}
        }),
    );

    let plan_change = personal_plan_change(&downgraded, event_at(), &prices()).unwrap();

    assert_eq!(
        (plan_change.from, plan_change.to),
        (PlanTier::Max, PlanTier::Premium)
    );
    assert_eq!(plan_change.at, plan_change.period.start);
}

#[test]
fn an_edit_of_another_item_or_no_price_change_is_not_a_plan_change() {
    let unrelated = change(
        EventType::CustomerSubscriptionUpdated,
        subscription("sub_Person", "active", 1_700_000_000, "price_max"),
        json!({"items": {"data": [{"id": "si_Unrelated", "price": {"id": "price_premium"}}]}}),
    );
    let renewal = change(
        EventType::CustomerSubscriptionUpdated,
        subscription("sub_Person", "active", 1_700_000_000, "price_max"),
        Value::Null,
    );

    assert_eq!(
        personal_plan_change(&unrelated, event_at(), &prices()),
        None
    );
    assert_eq!(personal_plan_change(&renewal, event_at(), &prices()), None);
}

#[test]
fn a_failed_payment_revokes_unless_another_personal_subscription_is_live() {
    let person = facts(subscription(
        "sub_Person",
        "active",
        1_700_000_000,
        "price_premium",
    ));
    let other = facts(subscription(
        "sub_Other",
        "active",
        1_800_000_000,
        "price_premium",
    ));
    let failed = invoice(false, "subscription_cycle");

    assert_eq!(
        decide_personal_invoice(
            &event_id(),
            event_at(),
            &failed,
            &person,
            &[person.clone(), other],
            &prices()
        )
        .unwrap(),
        PersonalDecision::KeepAccess
    );
    let PersonalDecision::Apply(update) = decide_personal_invoice(
        &event_id(),
        event_at(),
        &failed,
        &person,
        std::slice::from_ref(&person),
        &prices(),
    )
    .unwrap() else {
        panic!("expected a revoke");
    };
    assert_eq!(
        update.access,
        PersonalAccess::Revoke {
            status: RoleStatus::PastDue,
            tier: ProductTier::Opus
        }
    );
}

#[test]
fn a_paid_renewal_restores_access_with_renewal_evidence() {
    let person = facts(subscription(
        "sub_Person",
        "past_due",
        1_700_000_000,
        "price_premium",
    ));

    let PersonalDecision::Apply(update) = decide_personal_invoice(
        &event_id(),
        event_at(),
        &invoice(true, "subscription_cycle"),
        &person,
        &[],
        &prices(),
    )
    .unwrap() else {
        panic!("expected a restore");
    };

    assert_eq!(update.access, PersonalAccess::Grant(ProductTier::Opus));
    assert_eq!(update.verified[0].evidence, PeriodEvidence::Renewal);
    assert_eq!(
        update.period,
        Some(BillingPeriod {
            start: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
            end: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
        })
    );
}

#[test]
fn a_new_team_trial_starts_seats_and_pays() {
    let mut object = subscription("sub_Team", "trialing", 1_800_000_000, "price_premium");
    object["metadata"] = json!({"team_id": TEAM, "owner_id": "macro|owner@example.com"});
    let created = change(EventType::CustomerSubscriptionCreated, object, Value::Null);

    let update = decide_team_subscription(&event_id(), event_at(), &created).unwrap();

    assert_eq!(update.team_id.to_string(), TEAM);
    assert!(update.paying);
    assert!(update.started_trial);
    assert_eq!(
        update.owner.map(|owner| owner.as_ref().to_owned()),
        Some("macro|owner@example.com".to_owned())
    );
    let start = update.start.unwrap();
    assert_eq!(start.at, event_at());
    assert_eq!(
        start.period_start,
        DateTime::from_timestamp(1_800_000_000, 0).unwrap()
    );
}

#[test]
fn a_canceled_or_unpaid_team_stops_paying_and_an_incomplete_one_changes_nothing() {
    let mut canceled = subscription("sub_Team", "canceled", 1_800_000_000, "price_premium");
    canceled["metadata"]["team_id"] = json!(TEAM);
    let canceled = change(
        EventType::CustomerSubscriptionDeleted,
        canceled,
        Value::Null,
    );
    let update = decide_team_subscription(&event_id(), event_at(), &canceled).unwrap();
    assert!(!update.paying);
    assert_eq!(update.start, None);

    let mut incomplete = subscription("sub_Team", "incomplete", 1_800_000_000, "price_premium");
    incomplete["metadata"]["team_id"] = json!(TEAM);
    let incomplete = change(
        EventType::CustomerSubscriptionCreated,
        incomplete,
        Value::Null,
    );
    assert_eq!(
        decide_team_subscription(&event_id(), event_at(), &incomplete),
        None
    );

    let mut team = subscription("sub_Person", "active", 1_800_000_000, "price_premium");
    team["metadata"]["team_id"] = json!(TEAM);
    let update = decide_team_invoice(
        &event_id(),
        event_at(),
        &invoice(false, "subscription_cycle"),
        &facts(team),
    )
    .unwrap();
    assert!(!update.paying);
}

#[test]
fn conversions_report_new_live_subscriptions_and_cancellations_only() {
    let created = change(
        EventType::CustomerSubscriptionCreated,
        subscription("sub_Person", "active", 1_800_000_000, "price_premium"),
        Value::Null,
    );
    let activated = change(
        EventType::CustomerSubscriptionUpdated,
        subscription("sub_Person", "active", 1_800_000_000, "price_premium"),
        json!({"status": "incomplete"}),
    );
    let renewed = change(
        EventType::CustomerSubscriptionUpdated,
        subscription("sub_Person", "active", 1_800_000_000, "price_premium"),
        Value::Null,
    );
    let canceled = change(
        EventType::CustomerSubscriptionDeleted,
        subscription("sub_Person", "canceled", 1_800_000_000, "price_premium"),
        Value::Null,
    );

    assert_eq!(conversion(&created, None), Some(Conversion::Purchase));
    assert_eq!(conversion(&activated, None), Some(Conversion::Purchase));
    assert_eq!(conversion(&renewed, None), None);
    assert_eq!(conversion(&canceled, None), Some(Conversion::Cancel));
    // A canceled duplicate or a cancel that keeps access is not reported.
    assert_eq!(
        conversion(&created, Some(&PersonalDecision::CancelDuplicate)),
        None
    );
    assert_eq!(
        conversion(&canceled, Some(&PersonalDecision::KeepAccess)),
        None
    );
}

#[test]
fn only_complete_item_lists_yield_policy_periods() {
    let mut partial = subscription("sub_Person", "active", 1_800_000_000, "price_premium");
    partial["items"]["has_more"] = json!(true);
    assert!(subscription_periods(&event_id(), event_at(), &facts(partial), None).is_empty());

    let mut no_period = subscription("sub_Person", "active", 1_800_000_000, "price_premium");
    no_period["items"]["data"][0]
        .as_object_mut()
        .unwrap()
        .remove("current_period_end");
    assert!(subscription_periods(&event_id(), event_at(), &facts(no_period), None).is_empty());
}

#[test]
fn a_payment_after_the_subscription_ended_grants_nothing_back() {
    let person = facts(subscription(
        "sub_Person",
        "canceled",
        1_700_000_000,
        "price_premium",
    ));
    assert_eq!(
        decide_personal_invoice(
            &event_id(),
            event_at(),
            &invoice(true, "subscription_cycle"),
            &person,
            &[],
            &prices(),
        )
        .unwrap(),
        PersonalDecision::Ignore
    );

    let mut team = subscription(
        "sub_Team",
        "incomplete_expired",
        1_800_000_000,
        "price_premium",
    );
    team["metadata"]["team_id"] = json!(TEAM);
    assert_eq!(
        decide_team_invoice(
            &event_id(),
            event_at(),
            &invoice(true, "subscription_cycle"),
            &facts(team),
        ),
        None
    );
}

fn paid_invoice_of(price: &str) -> InvoiceFacts {
    let mut invoice = invoice(true, "subscription_cycle");
    for line in &mut invoice.lines {
        line.price = Some(price.parse().unwrap());
    }
    invoice
}

#[test]
fn legacy_prices_keep_premium_through_grant_renewal_and_cancel_and_revoke_only_premium() {
    for price in [MACRO_WEB_PRICE, PROFESSIONAL_PRICE] {
        let created = change(
            EventType::CustomerSubscriptionCreated,
            subscription("sub_Person", "active", 1_800_000_000, price),
            Value::Null,
        );
        let PersonalDecision::Apply(grant) = decide_personal_subscription(
            &event_id(),
            event_at(),
            &created,
            std::slice::from_ref(&created.subscription),
            &prices(),
        )
        .unwrap() else {
            panic!("expected a grant for {price}");
        };
        assert_eq!(grant.access, PersonalAccess::Grant(ProductTier::Opus));
        // No AI plan change is inferred from a price that is not sold.
        assert_eq!(grant.plan_change, None);

        let renewed = change(
            EventType::CustomerSubscriptionUpdated,
            subscription("sub_Person", "active", 1_800_000_000, price),
            json!({"current_period_start": 1_797_000_000}),
        );
        let PersonalDecision::Apply(renewal) = decide_personal_subscription(
            &event_id(),
            event_at(),
            &renewed,
            std::slice::from_ref(&renewed.subscription),
            &prices(),
        )
        .unwrap() else {
            panic!("expected a renewal for {price}");
        };
        assert_eq!(renewal.access, PersonalAccess::Grant(ProductTier::Opus));

        let person = facts(subscription("sub_Person", "past_due", 1_700_000_000, price));
        let PersonalDecision::Apply(paid) = decide_personal_invoice(
            &event_id(),
            event_at(),
            &paid_invoice_of(price),
            &person,
            std::slice::from_ref(&person),
            &prices(),
        )
        .unwrap() else {
            panic!("expected a paid renewal for {price}");
        };
        assert_eq!(paid.access, PersonalAccess::Grant(ProductTier::Opus));

        let canceled = change(
            EventType::CustomerSubscriptionDeleted,
            subscription("sub_Person", "canceled", 1_700_000_000, price),
            Value::Null,
        );
        let PersonalDecision::Apply(revoke) = decide_personal_subscription(
            &event_id(),
            event_at(),
            &canceled,
            std::slice::from_ref(&canceled.subscription),
            &prices(),
        )
        .unwrap() else {
            panic!("expected a revoke for {price}");
        };
        assert_eq!(
            revoke.access,
            PersonalAccess::Revoke {
                status: RoleStatus::Canceled,
                tier: ProductTier::Opus
            }
        );
    }
}

#[test]
fn an_unknown_price_still_revokes_premium_on_cancel_and_failed_payment_as_before() {
    let canceled = change(
        EventType::CustomerSubscriptionDeleted,
        subscription("sub_Person", "canceled", 1_700_000_000, UNLISTED_PRICE),
        Value::Null,
    );
    let PersonalDecision::Apply(cancel) = decide_personal_subscription(
        &event_id(),
        event_at(),
        &canceled,
        std::slice::from_ref(&canceled.subscription),
        &prices(),
    )
    .unwrap() else {
        panic!("expected a revoke");
    };
    assert_eq!(
        cancel.access,
        PersonalAccess::Revoke {
            status: RoleStatus::Canceled,
            tier: ProductTier::Opus
        }
    );

    for status in ["past_due", "unpaid", "paused", "incomplete_expired"] {
        let lapsed = change(
            EventType::CustomerSubscriptionUpdated,
            subscription("sub_Person", status, 1_700_000_000, UNLISTED_PRICE),
            json!({"status": "active"}),
        );
        let decision = decide_personal_subscription(
            &event_id(),
            event_at(),
            &lapsed,
            std::slice::from_ref(&lapsed.subscription),
            &prices(),
        )
        .unwrap();
        assert!(
            matches!(&decision, PersonalDecision::Apply(update) if matches!(update.access, PersonalAccess::Revoke { tier: ProductTier::Opus, .. })),
            "{status}: {decision:?}"
        );
    }

    let person = facts(subscription(
        "sub_Person",
        "active",
        1_700_000_000,
        UNLISTED_PRICE,
    ));
    let PersonalDecision::Apply(failed) = decide_personal_invoice(
        &event_id(),
        event_at(),
        &invoice(false, "subscription_cycle"),
        &person,
        std::slice::from_ref(&person),
        &prices(),
    )
    .unwrap() else {
        panic!("expected a revoke");
    };
    assert_eq!(
        failed.access,
        PersonalAccess::Revoke {
            status: RoleStatus::PastDue,
            tier: ProductTier::Opus
        }
    );
}

#[test]
fn an_unknown_price_dead_letters_a_paid_renewal() {
    let person = facts(subscription(
        "sub_Person",
        "active",
        1_700_000_000,
        UNLISTED_PRICE,
    ));
    assert_eq!(
        decide_personal_invoice(
            &event_id(),
            event_at(),
            &paid_invoice_of(UNLISTED_PRICE),
            &person,
            std::slice::from_ref(&person),
            &prices(),
        ),
        Err(UnknownPrice {
            subscription_id: "sub_Person".to_owned()
        })
    );
}

#[test]
fn analytics_skips_an_unknown_price_instead_of_failing() {
    let created = change(
        EventType::CustomerSubscriptionCreated,
        subscription("sub_Person", "active", 1_800_000_000, UNLISTED_PRICE),
        Value::Null,
    );
    assert_eq!(
        analytics_conversion(
            &event_id(),
            event_at(),
            &created,
            std::slice::from_ref(&created.subscription),
            &prices(),
        ),
        None
    );

    let legacy = change(
        EventType::CustomerSubscriptionCreated,
        subscription("sub_Person", "active", 1_800_000_000, MACRO_WEB_PRICE),
        Value::Null,
    );
    assert_eq!(
        analytics_conversion(
            &event_id(),
            event_at(),
            &legacy,
            std::slice::from_ref(&legacy.subscription),
            &prices(),
        ),
        Some(Conversion::Purchase)
    );
}

#[test]
fn a_deleted_team_ignores_its_subscription_events() {
    let mut object = subscription("sub_Team", "canceled", 1_800_000_000, MACRO_WEB_PRICE);
    object["metadata"]["team_id"] = json!(TEAM);
    let deleted = change(EventType::CustomerSubscriptionDeleted, object, Value::Null);
    let update = decide_team_subscription(&event_id(), event_at(), &deleted).unwrap();

    assert_eq!(
        decide_team_binding(&update, TeamState::Missing),
        TeamBinding::TeamGone
    );
    assert_eq!(
        decide_team_binding(
            &update,
            TeamState::Bound(Some("sub_Other".parse().unwrap()))
        ),
        TeamBinding::IgnoreLapse
    );
    assert_eq!(
        decide_team_binding(&update, TeamState::Bound(Some("sub_Team".parse().unwrap()))),
        TeamBinding::Apply { replaced: false }
    );
    assert_eq!(
        decide_team_binding(&update, TeamState::Bound(None)),
        TeamBinding::Apply { replaced: true }
    );
}

#[test]
fn canceling_a_personal_max_subscription_revokes_only_max() {
    // A team seat grants the team subscriber role and its own tier role
    // (Premium here); the personal Max revoke must leave that role alone.
    let canceled = change(
        EventType::CustomerSubscriptionDeleted,
        subscription("sub_Person", "canceled", 1_700_000_000, "price_max"),
        Value::Null,
    );
    let PersonalDecision::Apply(revoke) = decide_personal_subscription(
        &event_id(),
        event_at(),
        &canceled,
        std::slice::from_ref(&canceled.subscription),
        &prices(),
    )
    .unwrap() else {
        panic!("expected a revoke");
    };
    assert_eq!(
        revoke.access,
        PersonalAccess::Revoke {
            status: RoleStatus::Canceled,
            tier: ProductTier::Max
        }
    );
}
