use super::*;

#[test]
fn cost_cents_rounds_fractions_up_and_ignores_junk() {
    assert_eq!(cost_cents(16.0), 1_600);
    assert_eq!(cost_cents(0.001), 1);
    // 0.07 * 100.0 is 7.000000000000001 in binary floating point.
    assert_eq!(cost_cents(0.07), 7);
    assert_eq!(cost_cents(0.29), 29);
    assert_eq!(cost_cents(0.0), 0);
    assert_eq!(cost_cents(-3.0), 0);
    assert_eq!(cost_cents(f64::NAN), 0);
    assert_eq!(cost_cents(f64::INFINITY), 0);
}

#[test]
fn allowance_must_be_non_negative() {
    assert_eq!(IncludedAllowanceCents::new(0).unwrap().cents(), 0);
    assert_eq!(IncludedAllowanceCents::new(2_000).unwrap().cents(), 2_000);
    assert_eq!(
        IncludedAllowanceCents::new(-1),
        Err(PricingError::NegativeAllowance(-1))
    );
}

#[test]
fn markup_must_be_a_whole_percent_below_one_hundred() {
    assert_eq!(OverageMarkupPercent::new(0).unwrap().percent(), 0);
    assert_eq!(OverageMarkupPercent::new(5).unwrap().percent(), 5);
    assert_eq!(OverageMarkupPercent::new(99).unwrap().percent(), 99);
    assert_eq!(
        OverageMarkupPercent::new(100),
        Err(PricingError::MarkupOutOfRange(100))
    );
    assert_eq!(
        OverageMarkupPercent::new(-5),
        Err(PricingError::MarkupOutOfRange(-5))
    );
}

#[test]
fn pricing_exposes_every_configured_value() {
    let pricing = AiPricing::new(
        PlanAllowances {
            free: IncludedAllowanceCents::new(500).unwrap(),
            premium: IncludedAllowanceCents::new(3_500).unwrap(),
            max: IncludedAllowanceCents::new(15_000).unwrap(),
        },
        OverageMarkupPercent::new(12).unwrap(),
    );
    assert_eq!(pricing.included_allowance_cents_for(PlanTier::Free), 500);
    assert_eq!(
        pricing.included_allowance_cents_for(PlanTier::Premium),
        3_500
    );
    assert_eq!(pricing.included_allowance_cents_for(PlanTier::Max), 15_000);
    // The unqualified accessor is the default paid plan's.
    assert_eq!(pricing.included_allowance_cents(), 3_500);
    assert_eq!(pricing.overage_markup_percent(), 12);
    // A different markup prices the same cost differently.
    assert_eq!(pricing.extra_customer_cents(1_000), 1_120);
    assert_eq!(AiPricing::testing().extra_customer_cents(1_000), 1_050);
}

#[test]
fn markup_rounds_up_on_the_cumulative_total() {
    let pricing = AiPricing::testing();
    assert_eq!(pricing.extra_customer_cents(0), 0);
    assert_eq!(pricing.extra_customer_cents(1), 2);
    assert_eq!(pricing.extra_customer_cents(19), 20);
    assert_eq!(pricing.extra_customer_cents(20), 21);
    assert_eq!(pricing.extra_customer_cents(1_000), 1_050);
    assert_eq!(pricing.extra_customer_cents(1_500), 1_575);
    assert_eq!(pricing.extra_customer_cents(-5), 0);
}

#[test]
fn zero_markup_charges_cost_exactly() {
    let pricing = AiPricing::new(
        PlanAllowances::uniform(0),
        OverageMarkupPercent::new(0).unwrap(),
    );
    for cost in [0, 1, 7, 1_000, 123_456] {
        assert_eq!(pricing.extra_customer_cents(cost), cost);
        assert_eq!(pricing.cost_cents_covered_by(cost), cost);
    }
}

#[test]
fn cumulative_conversion_books_exact_increments() {
    let pricing = AiPricing::testing();
    // Settle at cost 1_000, then again at 1_500: the increments sum to extra(1_500).
    let first = pricing.extra_customer_cents(1_000);
    let second = pricing.extra_customer_cents(1_500) - first;
    assert_eq!((first, second), (1_050, 525));
    assert_eq!(first + second, pricing.extra_customer_cents(1_500));
    // Converting each increment on its own would overcharge.
    assert_eq!(
        pricing.extra_customer_cents(1) + pricing.extra_customer_cents(1),
        4
    );
    assert_eq!(pricing.extra_customer_cents(2), 3);
}

#[test]
fn covered_cost_is_the_exact_inverse_of_the_markup() {
    for markup in [0, 5, 17, 99] {
        let pricing = AiPricing::new(
            PlanAllowances::uniform(2_000),
            OverageMarkupPercent::new(markup).unwrap(),
        );
        assert_eq!(pricing.cost_cents_covered_by(0), 0);
        assert_eq!(pricing.cost_cents_covered_by(-1), 0);
        for cost in 0..10_000 {
            assert_eq!(
                pricing.cost_cents_covered_by(pricing.extra_customer_cents(cost)),
                cost
            );
        }
        for customer in 0..10_000 {
            let covered = pricing.cost_cents_covered_by(customer);
            assert!(pricing.extra_customer_cents(covered) <= customer);
            assert!(customer < pricing.extra_customer_cents(covered + 1));
        }
    }
    let pricing = AiPricing::testing();
    assert_eq!(pricing.cost_cents_covered_by(1), 0);
    assert_eq!(pricing.cost_cents_covered_by(2), 1);
    assert_eq!(pricing.cost_cents_covered_by(104), 99);
    assert_eq!(pricing.cost_cents_covered_by(105), 100);
}

#[test]
fn pricing_feeds_the_exact_money_policy() {
    use crate::domain::policy::included_public_usage;
    use ai_usage::domain::financial::{CustomerMoney, PublicUsage};

    let pricing = AiPricing::testing();
    let public_units_per_cent = CustomerMoney::UNITS_PER_CENT / 100;
    assert_eq!(
        included_public_usage(pricing).units(),
        pricing.included_allowance_cents() as u64 * public_units_per_cent
    );
    // A whole-percent markup over a denominator of 100 prices every public unit exactly.
    let numerator = (PERCENT + pricing.overage_markup_percent()) as u64;
    let money =
        CustomerMoney::from_public_ratio(PublicUsage::from_units(1), numerator, 100).unwrap();
    assert_eq!(money.units(), numerator);
}
