use super::*;
use uuid::Uuid;

fn billing() -> SubscriptionBillingFacts {
    SubscriptionBillingFacts {
        access: BillingAccess::Team(Some(TeamRole::Owner)),
        currency: "kwd".to_owned(),
        interval: BillingInterval::Month,
        items: vec![
            RecurringItem {
                kind: RecurringItemKind::Seat(SeatPlan::Premium),
                quantity: 3,
                unit_amount: 2500,
                name: "Seats".to_owned(),
            },
            RecurringItem {
                kind: RecurringItemKind::Computer(ComputerSize::Large),
                quantity: 1,
                unit_amount: 10000,
                name: "Computers".to_owned(),
            },
            RecurringItem {
                kind: RecurringItemKind::Other,
                quantity: 2,
                unit_amount: 500,
                name: "Other subscription item".to_owned(),
            },
        ],
        seats: vec![
            BillingSeat {
                plan: Some(SeatPlan::Premium),
                agent: false,
                included: false,
            },
            BillingSeat {
                plan: Some(SeatPlan::Premium),
                agent: true,
                included: false,
            },
            BillingSeat {
                plan: Some(SeatPlan::Premium),
                agent: true,
                included: true,
            },
        ],
        computers: vec![
            BillingComputer {
                id: ComputerId::new(Uuid::from_u128(1)),
                agent_user_id: Some(
                    MacroUserIdStr::parse_from_str("macro|agent@example.com").expect("agent id"),
                ),
                size: ComputerSize::Large,
                name: ComputerName::try_new("Agent").unwrap(),
                status: ComputerStatusKind::Ready,
                included: false,
            },
            BillingComputer {
                id: ComputerId::new(Uuid::from_u128(2)),
                agent_user_id: None,
                size: ComputerSize::Standard,
                name: ComputerName::try_new("Included agent").unwrap(),
                status: ComputerStatusKind::SettingUp,
                included: true,
            },
        ],
        next_invoice: Some(SubscriptionNextInvoice {
            date: chrono::DateTime::from_timestamp(1_800_000_000, 0),
            amount: 17321,
        }),
    }
}

#[test]
fn real_amounts_reconcile_without_inventing_prices_or_invoice_adjustments() {
    let result = billing().render().unwrap();
    assert_eq!(result.human_seats.quantity, 1);
    assert_eq!(result.human_seats.amount, 2500);
    assert_eq!(result.agent_seats.quantity, 1);
    assert_eq!(result.agent_seats.amount, 2500);
    assert_eq!(result.subscription_total, 18500);
    assert_eq!(
        result
            .line_items
            .iter()
            .map(|item| item.amount)
            .sum::<i64>(),
        result.subscription_total
    );
    assert_eq!(result.next_invoice.unwrap().amount, 17321);
    let included = result.line_items.iter().find(|item| item.included).unwrap();
    assert_eq!(included.amount, 0);
    assert_eq!(included.computer_id, Some(Uuid::from_u128(2)));
    let paid = result
        .line_items
        .iter()
        .find(|item| item.computer_id == Some(Uuid::from_u128(1)))
        .unwrap();
    assert_eq!(paid.amount, 10000);
    assert_eq!(
        paid.agent_user_id.as_ref().map(|id| id.as_ref()),
        Some("macro|agent@example.com")
    );
}

#[test]
fn ordinary_or_missing_team_membership_cannot_read_financial_facts() {
    for role in [Some(TeamRole::Member), None] {
        let mut facts = billing();
        facts.access = BillingAccess::Team(role);
        assert!(facts.render().is_none());
    }
    let mut facts = billing();
    facts.access = BillingAccess::Team(Some(TeamRole::Admin));
    assert!(facts.render().is_some());
}

#[test]
fn a_provider_quantity_smaller_than_known_seats_stays_unattributed() {
    let mut facts = billing();
    facts.items[0].quantity = 1;
    let result = facts.render().unwrap();
    assert_eq!(result.human_seats.quantity, 0);
    assert_eq!(result.agent_seats.quantity, 0);
    assert_eq!(result.subscription_total, 13500);
    assert!(
        result
            .line_items
            .iter()
            .any(|item| item.kind == SubscriptionBillingLineKind::Other && item.amount == 2500)
    );
}

#[test]
fn multiple_prices_for_the_same_plan_do_not_double_allocate_members() {
    let mut facts = billing();
    facts.items.push(RecurringItem {
        kind: RecurringItemKind::Seat(SeatPlan::Premium),
        quantity: 2,
        unit_amount: 2750,
        name: "Another seat item".to_owned(),
    });
    let result = facts.render().unwrap();
    assert_eq!(result.human_seats.quantity, 0);
    assert_eq!(result.agent_seats.quantity, 0);
    assert_eq!(result.subscription_total, 24000);
    assert_eq!(
        result
            .line_items
            .iter()
            .map(|item| item.amount)
            .sum::<i64>(),
        result.subscription_total
    );
}

#[test]
fn quantities_that_overflow_wire_amounts_are_unavailable() {
    let mut facts = billing();
    facts.items[0].quantity = u64::MAX;
    assert!(facts.render().is_none());
}

#[test]
fn typed_computer_billing_fields_keep_the_existing_json_schema() {
    use utoipa::PartialSchema;
    let billing = billing().render().expect("billing facts");
    let value = serde_json::to_value(&billing).expect("serialize");
    let computer = value["lineItems"]
        .as_array()
        .expect("items")
        .iter()
        .find(|item| item["agentUserId"] == "macro|agent@example.com")
        .expect("agent computer");
    assert_eq!(computer["status"], "ready");
    let schema = serde_json::to_value(SubscriptionBillingLineItem::schema()).expect("schema");
    assert!(schema["properties"]["agentUserId"]["$ref"].is_null());
    assert!(schema["properties"]["status"]["$ref"].is_null());
}
