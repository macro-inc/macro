#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// =============================================================================
// DISC
// =============================================================================

#[test]
fn fn_disc_example() {
    // settlement=2008-01-25 (39472), maturity=2008-06-15 (39614)
    // pr=97.975, redemption=100, basis=1 (actual/actual)
    // 142 actual days / 366 (2008 leap year) = 0.38798 yearfrac
    // DISC = (1 - 97.975/100) / 0.38798 ≈ 0.052193662
    let mut model = new_empty_model();
    model._set("A1", "=DISC(39472, 39614, 97.975, 100, 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.052193662");
}

#[test]
fn fn_disc_default_basis() {
    let mut model = new_empty_model();
    model._set("A1", "=DISC(39472, 39614, 97.975, 100)");
    model.evaluate();
    // basis 0: days360(39472,39614)/360
    assert!(model._get_text("A1").starts_with("0.05"));
}

#[test]
fn fn_disc_error_pr_zero() {
    let mut model = new_empty_model();
    model._set("A1", "=DISC(39472, 39614, 0, 100, 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_disc_error_settlement_after_maturity() {
    let mut model = new_empty_model();
    model._set("A1", "=DISC(39614, 39472, 97.975, 100, 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

// =============================================================================
// FVSCHEDULE
// =============================================================================

#[test]
fn fn_fvschedule_example() {
    // principal=1, schedule={0.09, 0.11, 0.1}
    let mut model = new_empty_model();
    model._set("B1", "0.09");
    model._set("B2", "0.11");
    model._set("B3", "0.1");
    model._set("A1", "=FVSCHEDULE(1, B1:B3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"1.33089");
}

#[test]
fn fn_fvschedule_single_rate() {
    let mut model = new_empty_model();
    model._set("B1", "0.05");
    model._set("A1", "=FVSCHEDULE(1000, B1:B1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"1050");
}

#[test]
fn fn_fvschedule_error_rate_too_low() {
    let mut model = new_empty_model();
    model._set("B1", "-1.5");
    model._set("A1", "=FVSCHEDULE(1000, B1:B1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"-500");
}

#[test]
fn fn_fvschedule_more() {
    let mut model = new_empty_model();
    model._set("A1", "=FVSCHEDULE(120, {0.2, 0.4, 0.6, 0.8})");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"580.608");
}

// =============================================================================
// INTRATE
// =============================================================================

#[test]
fn fn_intrate_example() {
    // settlement=2008-02-15 (39493), maturity=2008-05-15 (39583)
    // investment=1000000, redemption=1014420, basis=2
    let mut model = new_empty_model();
    model._set("A1", "=INTRATE(39493, 39583, 1000000, 1014420, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.05768");
}

#[test]
fn fn_intrate_error_investment_zero() {
    let mut model = new_empty_model();
    model._set("A1", "=INTRATE(39493, 39583, 0, 1014420, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

// =============================================================================
// PRICEDISC
// =============================================================================

#[test]
fn fn_pricedisc_example() {
    // settlement=2008-02-16 (39494), maturity=2008-03-01 (39508)
    // discount=0.0525, redemption=100, basis=2 (actual/360)
    // 14 actual days / 360 → yearfrac=0.038889
    // PRICEDISC = 100 * (1 - 0.0525 * 0.038889) ≈ 99.795833333
    let mut model = new_empty_model();
    model._set("A1", "=PRICEDISC(39494, 39508, 0.0525, 100, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"99.795833333");
}

#[test]
fn fn_pricedisc_error_discount_zero() {
    let mut model = new_empty_model();
    model._set("A1", "=PRICEDISC(39494, 39508, 0, 100, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

// =============================================================================
// PRICEMAT
// =============================================================================

#[test]
fn fn_pricemat_example() {
    // settlement=2008-02-15 (39493), maturity=2008-04-13 (39551)
    // issue=2007-11-11 (39397), rate=0.0610, yld=0.0625, basis=0 (US 30/360)
    // par * [(1 + rate * dim) / (1 + yld * dsm) - rate * dis]
    let mut model = new_empty_model();
    model._set("A1", "=PRICEMAT(39493, 39551, 39397, 0.0610, 0.0625, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"99.960195753");
}

#[test]
fn fn_pricemat_error_settlement_after_maturity() {
    let mut model = new_empty_model();
    model._set("A1", "=PRICEMAT(39551, 39493, 39397, 0.061, 0.0625, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

// =============================================================================
// RECEIVED
// =============================================================================

#[test]
fn fn_received_example() {
    // settlement=2008-02-15 (39493), maturity=2008-05-15 (39583)
    // investment=1000000, discount=0.0575, basis=2 (actual/360)
    // 90 days / 360 = 0.25 yearfrac
    // RECEIVED = 1000000 / (1 - 0.0575 * 0.25) ≈ 1014584.654
    let mut model = new_empty_model();
    model._set("A1", "=RECEIVED(39493, 39583, 1000000, 0.0575, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"1014584.654407102");
}

#[test]
fn fn_received_error_investment_zero() {
    let mut model = new_empty_model();
    model._set("A1", "=RECEIVED(39493, 39583, 0, 0.0575, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

// =============================================================================
// YIELDDISC
// =============================================================================

#[test]
fn fn_yielddisc_example() {
    // settlement=2008-02-16 (39494), maturity=2008-03-01 (39508)
    // pr=97.975, redemption=100, basis=2 (actual/360)
    // 14 actual days / 360 → yearfrac=0.038889
    // YIELDDISC = (100/97.975 - 1) / 0.038889 ≈ 0.531476689
    let mut model = new_empty_model();
    model._set("A1", "=YIELDDISC(39494, 39508, 97.975, 100, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.531476689");
}

#[test]
fn fn_yielddisc_error_pr_zero() {
    let mut model = new_empty_model();
    model._set("A1", "=YIELDDISC(39494, 39508, 0, 100, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

// =============================================================================
// YIELDMAT
// =============================================================================

#[test]
fn fn_yieldmat_example() {
    // settlement=2008-03-15 (39522), maturity=2008-11-03 (39755)
    // issue=2007-11-08 (39394), rate=0.0625, price=100.0123, basis=0 (US 30/360)
    // YIELDMAT = [(1 + rate*dim) / (price/100 + rate*dis) - 1] / dsm
    let mut model = new_empty_model();
    model._set("A1", "=YIELDMAT(39522, 39755, 39394, 0.0625, 100.0123, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.060954334");
}

#[test]
fn fn_yieldmat_error_settlement_after_maturity() {
    let mut model = new_empty_model();
    model._set("A1", "=YIELDMAT(39755, 39522, 39394, 0.0625, 100.0123, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}
