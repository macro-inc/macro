use super::*;
use crate::domain::computer_billing::IntervalPrices;
use hosted_runtimes::domain::size::{
    CatalogEntryId, ComputerResources, ComputerSize, DiskGib, MemoryGib, Vcpus,
};
use uuid::Uuid;

fn billing() -> SubscriptionBillingFacts {
    SubscriptionBillingFacts {
        access: BillingAccess::Team(Some(TeamRole::Owner)),
        currency: "kwd".to_owned(),
        interval: BillingInterval::Month,
        items: vec![
            RecurringItem {
                kind: RecurringItemKind::Seat(SeatPlan::Premium),
                price_id: StripePriceId::parse("price_premium").unwrap(),
                computer_id: None,
                quantity: 3,
                unit_amount: 2500,
                name: "Seats".to_owned(),
            },
            RecurringItem {
                kind: RecurringItemKind::Other,
                price_id: StripePriceId::parse("price_large_recorded").unwrap(),
                computer_id: None,
                quantity: 1,
                unit_amount: 10000,
                name: "Computers".to_owned(),
            },
            RecurringItem {
                kind: RecurringItemKind::Other,
                price_id: StripePriceId::parse("price_unrelated").unwrap(),
                computer_id: None,
                quantity: 2,
                unit_amount: 500,
                name: "Other subscription item".to_owned(),
            },
        ],
        seats: vec![
            BillingSeat {
                plan: Some(SeatPlan::Premium),
            },
            BillingSeat {
                plan: Some(SeatPlan::Premium),
            },
        ],
        computers: vec![
            BillingComputer {
                id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
                catalog_entry: CatalogEntry {
                    id: CatalogEntryId::try_new("large@2026-10".to_owned()).unwrap(),
                    size: ComputerSize::Large,
                    resources: ComputerResources {
                        vcpus: Vcpus::new(8),
                        memory_gib: MemoryGib::new(16),
                        disk_gib: DiskGib::new(200),
                    },
                },
                price_id: Some(StripePriceId::parse("price_large_recorded").unwrap()),
                name: ComputerName::try_new("Build box").unwrap(),
                status: ComputerStatusKind::Ready,
                included: false,
            },
            BillingComputer {
                id: ComputerId::new_from_uuid(Uuid::from_u128(2)),
                catalog_entry: CatalogEntry {
                    id: CatalogEntryId::try_new("standard@2026-10".to_owned()).unwrap(),
                    size: ComputerSize::Standard,
                    resources: ComputerResources {
                        vcpus: Vcpus::new(4),
                        memory_gib: MemoryGib::new(8),
                        disk_gib: DiskGib::new(100),
                    },
                },
                price_id: None,
                name: ComputerName::try_new("Included box").unwrap(),
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
    assert_eq!(result.human_seats.quantity, 2);
    assert_eq!(result.human_seats.amount, 5000);
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
        price_id: StripePriceId::parse("price_premium").unwrap(),
        computer_id: None,
        quantity: 2,
        unit_amount: 2750,
        name: "Another seat item".to_owned(),
    });
    let result = facts.render().unwrap();
    assert_eq!(result.human_seats.quantity, 0);
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
        .find(|item| item["computerId"] == Uuid::from_u128(1).to_string())
        .expect("paid computer");
    assert_eq!(computer["status"], "ready");
    let schema = serde_json::to_value(SubscriptionBillingLineItem::schema()).expect("schema");
    assert!(schema["properties"]["status"]["$ref"].is_null());
}

#[test]
fn changing_configured_prices_never_relabels_a_recorded_computer() {
    let seats = SeatPrices {
        premium: StripePriceId::parse("price_premium").unwrap(),
        max: None,
    };
    let empty = IntervalPrices {
        monthly: None,
        yearly: None,
    };
    let old = StripePriceId::parse("price_large_recorded").unwrap();
    let original = ComputerPrices {
        standard: empty.clone(),
        large: IntervalPrices {
            monthly: Some(old.clone()),
            yearly: None,
        },
        xl: empty.clone(),
    };
    let changed = ComputerPrices {
        standard: IntervalPrices {
            monthly: Some(old),
            yearly: None,
        },
        large: IntervalPrices {
            monthly: Some(StripePriceId::parse("price_large_new").unwrap()),
            yearly: None,
        },
        xl: empty,
    };
    for configured in [original, changed] {
        let mut facts = billing();
        let item = &mut facts.items[1];
        item.kind = RecurringItemKind::for_provider_price(
            &seats,
            &configured,
            &facts.computers,
            &item.price_id,
            item.computer_id,
        );
        let result = facts.render().unwrap();
        let row = result
            .line_items
            .iter()
            .find(|row| row.computer_id == Some(Uuid::from_u128(1)))
            .unwrap();
        assert_eq!(row.name, "Build box");
        assert_eq!(row.size, Some(ComputerSize::Large));
        assert_eq!(row.amount, 10000);
    }
}

#[test]
fn metadata_links_a_computer_without_inferring_its_size_from_a_new_price() {
    let mut facts = billing();
    facts.items[1].price_id = StripePriceId::parse("price_replaced").unwrap();
    facts.items[1].computer_id = Some(ComputerId::new_from_uuid(Uuid::from_u128(1)));
    let result = facts.render().unwrap();
    let row = result
        .line_items
        .iter()
        .find(|row| row.computer_id == Some(Uuid::from_u128(1)))
        .unwrap();
    assert_eq!(row.size, Some(ComputerSize::Large));
    assert_eq!(row.amount, 10000);
}

#[test]
fn duplicate_provider_items_do_not_allocate_the_same_computer_twice() {
    let mut facts = billing();
    facts.items.push(facts.items[1].clone());
    let result = facts.render().unwrap();
    assert!(
        !result
            .line_items
            .iter()
            .any(|row| row.computer_id == Some(Uuid::from_u128(1)))
    );
    assert_eq!(
        result.line_items.iter().map(|row| row.amount).sum::<i64>(),
        result.subscription_total
    );
}

#[test]
fn an_unlinked_legacy_charge_has_no_invented_computer_size() {
    let mut facts = billing();
    facts.computers[0].price_id = None;
    let seats = SeatPrices {
        premium: StripePriceId::parse("price_premium").unwrap(),
        max: None,
    };
    let prices = ComputerPrices {
        standard: IntervalPrices {
            monthly: Some(facts.items[1].price_id.clone()),
            yearly: None,
        },
        large: IntervalPrices {
            monthly: None,
            yearly: None,
        },
        xl: IntervalPrices {
            monthly: None,
            yearly: None,
        },
    };
    let item = &mut facts.items[1];
    item.kind = RecurringItemKind::for_provider_price(
        &seats,
        &prices,
        &facts.computers,
        &item.price_id,
        None,
    );
    let result = facts.render().unwrap();
    let row = result
        .line_items
        .iter()
        .find(|row| row.kind == SubscriptionBillingLineKind::Computer && !row.included)
        .unwrap();
    assert_eq!(row.name, "Computer");
    assert_eq!(row.size, None);
    assert_eq!(row.computer_id, None);
    assert_eq!(row.amount, 10000);
}
