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
fn markup_rounds_up_on_the_cumulative_total() {
    assert_eq!(extra_customer_cents(0), 0);
    assert_eq!(extra_customer_cents(1), 2);
    assert_eq!(extra_customer_cents(19), 20);
    assert_eq!(extra_customer_cents(20), 21);
    assert_eq!(extra_customer_cents(1_000), 1_050);
    assert_eq!(extra_customer_cents(1_500), 1_575);
    assert_eq!(extra_customer_cents(-5), 0);
}

#[test]
fn cumulative_conversion_books_exact_increments() {
    // Settle at cost 1_000, then again at 1_500: the increments sum to extra(1_500).
    let first = extra_customer_cents(1_000);
    let second = extra_customer_cents(1_500) - first;
    assert_eq!((first, second), (1_050, 525));
    assert_eq!(first + second, extra_customer_cents(1_500));
    // Converting each increment on its own would overcharge.
    assert_eq!(extra_customer_cents(1) + extra_customer_cents(1), 4);
    assert_eq!(extra_customer_cents(2), 3);
}

#[test]
fn covered_cost_is_the_exact_inverse_of_the_markup() {
    assert_eq!(cost_cents_covered_by(0), 0);
    assert_eq!(cost_cents_covered_by(1), 0);
    assert_eq!(cost_cents_covered_by(2), 1);
    assert_eq!(cost_cents_covered_by(104), 99);
    assert_eq!(cost_cents_covered_by(105), 100);
    assert_eq!(cost_cents_covered_by(-1), 0);
    for cost in 0..10_000 {
        assert_eq!(cost_cents_covered_by(extra_customer_cents(cost)), cost);
    }
    for customer in 0..10_000 {
        let covered = cost_cents_covered_by(customer);
        assert!(extra_customer_cents(covered) <= customer);
        assert!(customer < extra_customer_cents(covered + 1));
    }
}

#[test]
fn constants_feed_the_exact_money_policy() {
    use crate::domain::policy::INCLUDED_PUBLIC_USAGE;
    use ai_usage::domain::financial::{CustomerMoney, PublicUsage};

    let public_units_per_cent = CustomerMoney::UNITS_PER_CENT / 100;
    assert_eq!(
        INCLUDED_PUBLIC_USAGE.units(),
        INCLUDED_ALLOWANCE_CENTS as u64 * public_units_per_cent
    );
    // A whole-percent markup over a denominator of 100 prices every public unit exactly.
    let numerator = (PERCENT + OVERAGE_MARKUP_PERCENT) as u64;
    let money =
        CustomerMoney::from_public_ratio(PublicUsage::from_units(1), numerator, 100).unwrap();
    assert_eq!(money.units(), numerator);
}
