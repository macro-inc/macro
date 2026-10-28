#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// Odd first long period (issue to settlement): Jan 15, 2020 => March 1, 2021
#[test]
fn test_oddfprice_basis1_2() {
    let mut model = new_empty_model();
    // Too few args
    model._set("A1", "=DATE(2020,3,1)"); // Settlement: 1/March/2020
    model._set("A2", "=DATE(2030,3,1)"); // Maturity: 1/March/2030
    model._set("A3", "=DATE(2020,1,15)"); // Issue: 15/Jan/2020
    model._set("A4", "=DATE(2021,3,1)"); // 1/March/2021
    model._set("A5", "7.5%"); // Rate: 7.5%
    model._set("A6", "7%"); // Yield: 7%
    model._set("A7", "120"); // Redemption
    model._set("A8", "1"); // Frequency: 1 (Annual)
    model._set("A9", "2"); // Basis: 2 (Actual/360)
    model._set("C3", "=ODDFPRICE(A1,A2,A3,A4,A5,A6,A7,A8,A9)");
    model.evaluate();
    assert_eq!(model._get_text("C3"), "113.508466507");
    // 115.98854775223758 yield 6.7%
}

// =ODDFPRICE("3/1/2020","3/1/2030","1/15/2020","3/1/2021",7.5%,0%,120,1,2)

#[test]
fn test_oddfprice_basis_2_zero_yield() {
    let mut model = new_empty_model();
    // Too few args
    model._set("A1", "=DATE(2020,3,1)"); // Settlement: 1/March/2020
    model._set("A2", "=DATE(2030,3,1)"); // Maturity: 1/March/2030
    model._set("A3", "=DATE(2020,1,15)"); // Issue: 15/Jan/2020
    model._set("A4", "=DATE(2021,3,1)"); // 1/March/2021
    model._set("A5", "7.5%"); // Rate: 7.5%
    model._set("A6", "0%"); // Yield: 0%
    model._set("A7", "120"); // Redemption
    model._set("A8", "1"); // Frequency: 1 (Annual)
    model._set("A9", "2"); // Basis: 2 (Actual/360)
    model._set("C3", "=ODDFPRICE(A1,A2,A3,A4,A5,A6,A7,A8,A9)");
    model.evaluate();
    assert_eq!(model._get_text("C3"), "195");
}

// =ODDFPRICE("3/1/2020","3/1/2030","1/15/2020","3/1/2021",0%,10%,100,1,2)

#[test]
fn test_oddfprice_basis_2_zero_rate() {
    let mut model = new_empty_model();
    // Too few args
    model._set("A1", "=DATE(2020,3,1)"); // Settlement: 1/March/2020
    model._set("A2", "=DATE(2030,3,1)"); // Maturity: 1/March/2030
    model._set("A3", "=DATE(2020,1,15)"); // Issue: 15/Jan/2020
    model._set("A4", "=DATE(2021,3,1)"); // 1/March/2021
    model._set("A5", "0%"); // Rate: 0%
    model._set("A6", "10%"); // Yield: 10%
    model._set("A7", "100"); // Redemption
    model._set("A8", "1"); // Frequency: 1 (Annual)
    model._set("A9", "2"); // Basis: 2 (Actual/360)
    model._set("C3", "=ODDFPRICE(A1,A2,A3,A4,A5,A6,A7,A8,A9)");
    model.evaluate();
    assert_eq!(model._get_text("C3"), "38.503326319");
}

#[test]
fn test_oddfprice_basis2_long_first_period() {
    // Reverse-engineered against Excel to machine precision (131.48376704654200).
    // Long odd first period, semiannual, Actual/360. The stub (issue->first
    // quasi-coupon date) must be prorated over the nominal length 360/freq = 180,
    // not the period's actual length (182).
    let mut model = new_empty_model();
    model._set("A1", "=DATE(2020,3,1)"); // settlement
    model._set("A2", "=DATE(2030,3,1)"); // maturity
    model._set("A3", "=DATE(2020,1,15)"); // issue
    model._set("A4", "=DATE(2021,3,1)"); // first coupon
    model._set("A5", "7.5%"); // rate
    model._set("A6", "5%"); // yield
    model._set("A7", "120"); // redemption
    model._set("A8", "2"); // frequency: semiannual
    model._set("A9", "2"); // basis: Actual/360
    model._set("C3", "=ODDFPRICE(A1,A2,A3,A4,A5,A6,A7,A8,A9)");
    model.evaluate();
    assert_eq!(model._get_text("C3"), "131.483767047");
}

#[test]
fn test_oddfprice_basis1_long_first_period_unchanged() {
    // Same bond, Actual/Actual. Stub prorated over its actual length (182).
    let mut model = new_empty_model();
    model._set("A1", "=DATE(2020,3,1)");
    model._set("A2", "=DATE(2030,3,1)");
    model._set("A3", "=DATE(2020,1,15)");
    model._set("A4", "=DATE(2021,3,1)");
    model._set("A5", "7.5%");
    model._set("A6", "5%");
    model._set("A7", "120");
    model._set("A8", "2");
    model._set("A9", "1"); // basis: Actual/Actual
    model._set("C3", "=ODDFPRICE(A1,A2,A3,A4,A5,A6,A7,A8,A9)");
    model.evaluate();
    assert_eq!(model._get_text("C3"), "131.556968693");
}
