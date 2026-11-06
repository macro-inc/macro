use super::*;

fn prices() -> ComputerPrices {
    ComputerPrices {
        standard: IntervalPrices {
            monthly: Some(stripe_price_id::StripePriceId::parse("price_standard_month").unwrap()),
            yearly: Some(stripe_price_id::StripePriceId::parse("price_standard_year").unwrap()),
        },
        large: IntervalPrices {
            monthly: Some(stripe_price_id::StripePriceId::parse("price_large_month").unwrap()),
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
        prices()
            .price_id(ComputerSize::Large, BillingInterval::Month)
            .map(StripePriceId::as_str),
        Some("price_large_month")
    );
}
