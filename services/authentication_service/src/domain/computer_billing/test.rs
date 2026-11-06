use super::*;

fn prices() -> ComputerPrices {
    ComputerPrices {
        standard: IntervalPrices {
            monthly: Some("price_standard_month".into()),
            yearly: Some("price_standard_year".into()),
        },
        large: IntervalPrices {
            monthly: Some("price_large_month".into()),
            yearly: None,
        },
        xl: IntervalPrices {
            monthly: None,
            yearly: None,
        },
    }
}

#[test]
fn computer_items_are_counted_per_size_across_intervals_and_seats_are_ignored() {
    let counts = prices().billed_counts([
        ("price_pro", 4),
        ("price_standard_month", 2),
        ("price_standard_year", 1),
        ("price_large_month", 3),
    ]);

    assert_eq!(
        counts,
        [
            (ComputerSize::Standard, 3),
            (ComputerSize::Large, 3),
            (ComputerSize::Xl, 0),
        ]
    );
}

#[test]
fn an_unset_price_is_not_sold() {
    assert_eq!(
        prices().price_id(ComputerSize::Large, BillingInterval::Year),
        None
    );
    assert_eq!(
        prices().price_id(ComputerSize::Large, BillingInterval::Month),
        Some("price_large_month")
    );
}
