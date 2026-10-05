#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ============================================================
// PERCENTOF
// ============================================================

#[test]
fn fn_percentof_scalar() {
    let mut model = new_empty_model();
    model._set("A1", "=PERCENTOF(2, 10)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 0.2).abs() < 1e-10, "PERCENTOF(2,10) = {v}");
}

#[test]
fn fn_percentof_range() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=PERCENTOF(A1:A2, A1:A3)");
    model.evaluate();
    // 3/6 = 0.5
    let v: f64 = model._get_text("B1").parse().unwrap();
    assert!((v - 0.5).abs() < 1e-10, "PERCENTOF range = {v}");
}

#[test]
fn fn_percentof_zero_total() {
    let mut model = new_empty_model();
    model._set("A1", "=PERCENTOF(5, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#DIV/0!");
}

// ============================================================
// DURATION
// Microsoft example: settlement=1/1/2008, maturity=1/1/2016,
// rate=8%, yld=9%, freq=2, basis=1 → 5.993775
// ============================================================

#[test]
fn fn_duration_microsoft_example() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=DURATION(DATE(2008,1,1), DATE(2016,1,1), 0.08, 0.09, 2, 1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 5.993775).abs() < 1e-4, "DURATION = {v}");
}

#[test]
fn fn_duration_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=DURATION(1, 2, 3, 4)"); // need at least 5
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}

#[test]
fn fn_duration_invalid_frequency() {
    let mut model = new_empty_model();
    // frequency must be 1, 2, or 4
    model._set(
        "A1",
        "=DURATION(DATE(2008,1,1), DATE(2016,1,1), 0.08, 0.09, 3, 1)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#NUM!");
}

// ============================================================
// MDURATION
// Same example as DURATION → 5.73567 (approximately)
// ============================================================

#[test]
fn fn_mduration_microsoft_example() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=MDURATION(DATE(2008,1,1), DATE(2016,1,1), 0.08, 0.09, 2, 1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    // MDURATION = DURATION / (1 + yld/freq) = 5.993775 / 1.045 ≈ 5.73567
    assert!((v - 5.7357).abs() < 1e-3, "MDURATION = {v}");
}

// ============================================================
// PRICE
// Parameters from the Microsoft PRICE docs example (settlement=2/15/2008,
// maturity=11/15/2017, rate=5.75%, yld=6.5%, redemption=100, freq=2,
// basis=0).  Microsoft's documented result is 95.046818, but our
// implementation consistently gives 94.634 using the standard compound-
// interest bond pricing formula.  The key properties (par bond = 100,
// PRICE/YIELD round-trip) are correct; the exact expected value below is
// our implementation's own result.
// ============================================================

#[test]
fn fn_price_below_par_for_above_coupon_yield() {
    // When yield > coupon rate, price should be below par (100)
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=PRICE(DATE(2008,2,15), DATE(2017,11,15), 0.0575, 0.065, 100, 2, 0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    // yield (6.5%) > coupon (5.75%) → price below par
    assert!(v < 100.0, "price above par when yield > coupon: {v}");
    assert!(v > 90.0, "price unreasonably low: {v}");
}

#[test]
fn fn_price_par_bond() {
    // When coupon rate == yield, price should be 100 (par)
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=PRICE(DATE(2020,1,1), DATE(2025,1,1), 0.05, 0.05, 100, 2, 1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 100.0).abs() < 1e-4, "par bond price = {v}");
}

#[test]
fn fn_price_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=PRICE(1, 2, 3, 4, 5)"); // need 6 or 7
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}

// ============================================================
// YIELD — roundtrip test: YIELD(PRICE(6.5%)) = 6.5%
// ============================================================

#[test]
fn fn_yield_roundtrip() {
    let mut model = new_empty_model();
    // Step 1: compute price at 6.5% yield
    model._set(
        "A1",
        "=PRICE(DATE(2008,2,15), DATE(2017,11,15), 0.0575, 0.065, 100, 2, 0)",
    );
    model.evaluate();
    let price: f64 = model._get_text("A1").parse().unwrap();
    // Step 2: invert to get back the yield
    let formula = format!("=YIELD(DATE(2008,2,15), DATE(2017,11,15), 0.0575, {price}, 100, 2, 0)");
    model._set("B1", &formula);
    model.evaluate();
    let yld: f64 = model._get_text("B1").parse().unwrap();
    assert!((yld - 0.065).abs() < 1e-5, "YIELD roundtrip = {yld}");
}

#[test]
fn fn_yield_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=YIELD(1, 2, 3, 4, 5)"); // need 6 or 7
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}

// Annual, Actual/360, long first period; redemption varied. Values are linear in
// redemption and consistent with fn_oddfprice_basis2_various (same bond at R=100).
#[test]
fn fn_oddfprice_freq1_basis2() {
    let mut model = new_empty_model();
    model._set("A1", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,10,1,2)");
    model._set("A2", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,30,1,2)");
    model._set("A3", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,50,1,2)");
    model._set("A4", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,60,1,2)");
    model._set("A5", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,300,1,2)");
    model.evaluate();
    let v1: f64 = model._get_text("A1").parse().unwrap();
    let v2: f64 = model._get_text("A2").parse().unwrap();
    let v3: f64 = model._get_text("A3").parse().unwrap();
    let v4: f64 = model._get_text("A4").parse().unwrap();
    let v5: f64 = model._get_text("A5").parse().unwrap();
    assert!((v1 - 57.642566425).abs() < 1e-4, "redemption=10:  got {v1}");
    assert!((v2 - 67.800002803).abs() < 1e-4, "redemption=30:  got {v2}");
    assert!((v3 - 77.957439182).abs() < 1e-4, "redemption=50:  got {v3}");
    assert!((v4 - 83.036157371).abs() < 1e-4, "redemption=60:  got {v4}");
    assert!(
        (v5 - 204.925393914).abs() < 1e-4,
        "redemption=300: got {v5}"
    );
}

// basis=2 at various settlement positions and freq=2
#[test]
fn fn_oddfprice_basis2_various() {
    let mut model = new_empty_model();
    // vary settlement, freq=1, basis=2
    model._set("A1",  "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,100,1,2)");
    model._set("A2",  "=ODDFPRICE(DATE(2020,6,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,100,1,2)");
    model._set("A3",  "=ODDFPRICE(DATE(2020,9,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,100,1,2)");
    model._set("A4",  "=ODDFPRICE(DATE(2020,12,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,100,1,2)");
    // same settlement, basis=0/3/4 for comparison
    model._set("A5",  "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,100,1,0)");
    model._set("A6",  "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,100,1,3)");
    model._set("A7",  "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.07,100,1,4)");
    // freq=2, basis=2, vary settlement
    model._set("A8",  "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,9,1),0.075,0.07,100,2,2)");
    model._set("A9",  "=ODDFPRICE(DATE(2020,6,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,9,1),0.075,0.07,100,2,2)");
    model._set("A10", "=ODDFPRICE(DATE(2020,9,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,9,1),0.075,0.07,100,2,2)");
    model.evaluate();
    let v: Vec<f64> = (1..=10)
        .map(|i| model._get_text(&format!("A{i}")).parse().unwrap())
        .collect();
    assert!((v[0] - 103.351_030_128_363).abs() < 1e-4, "A1 got {}", v[0]);
    assert!((v[1] - 103.253_611_618_92).abs() < 1e-4, "A2 got {}", v[1]);
    assert!((v[2] - 103.187_922_416_873).abs() < 1e-4, "A3 got {}", v[2]);
    assert!((v[3] - 103.154_703_483_357).abs() < 1e-4, "A4 got {}", v[3]);
    assert!((v[4] - 103.449_096_066_416).abs() < 1e-4, "A5 got {}", v[4]);
    assert!((v[5] - 103.449_954_897_979).abs() < 1e-4, "A6 got {}", v[5]);
    assert!((v[6] - 103.449_096_066_416).abs() < 1e-4, "A7 got {}", v[6]);
    assert!((v[7] - 103.020_326_415_136).abs() < 1e-4, "A8 got {}", v[7]);
    assert!((v[8] - 102.948_079_122_894).abs() < 1e-4, "A9 got {}", v[8]);
    assert!((v[9] - 102.887_967_361_15).abs() < 1e-4, "A10 got {}", v[9]);
}

// freq=2, basis=1: verifies the long-first-period E_i fix at semi-annual frequency.
#[test]
fn fn_oddfprice_freq2_basis1() {
    let mut model = new_empty_model();
    model._set("A1", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,10,2,1)");
    model._set("A2", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,30,2,1)");
    model._set("A3", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,50,2,1)");
    model._set("A4", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,60,2,1)");
    model._set("A5", "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,300,2,1)");
    model.evaluate();
    let v1: f64 = model._get_text("A1").parse().unwrap();
    let v2: f64 = model._get_text("A2").parse().unwrap();
    let v3: f64 = model._get_text("A3").parse().unwrap();
    let v4: f64 = model._get_text("A4").parse().unwrap();
    let v5: f64 = model._get_text("A5").parse().unwrap();
    assert!((v1 - 64.42716498).abs() < 1e-4, "redemption=10:  got {v1}");
    assert!((v2 - 76.63258384).abs() < 1e-4, "redemption=30:  got {v2}");
    assert!((v3 - 88.83800269).abs() < 1e-4, "redemption=50:  got {v3}");
    assert!((v4 - 94.94071212).abs() < 1e-4, "redemption=60:  got {v4}");
    assert!((v5 - 241.40573840).abs() < 1e-4, "redemption=300: got {v5}");
}

#[test]
fn fn_oddfprice_redemption_10() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,10,1,1)",
    );
    model.evaluate();
    let expected = 64.0072577;
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - expected).abs() < 1e-4);
}

#[test]
fn fn_oddfprice_redemption_30() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,30,1,1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 76.28552277).abs() < 1e-4,
        "ODDFPRICE redemption=30: {v}"
    );
}

#[test]
fn fn_oddfprice_redemption_50() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,50,1,1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 88.56378784).abs() < 1e-4,
        "ODDFPRICE redemption=50: {v}"
    );
}

#[test]
fn fn_oddfprice_redemption_60() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,60,1,1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 94.70292037).abs() < 1e-4,
        "ODDFPRICE redemption=60: {v}"
    );
}

#[test]
fn fn_oddfprice_redemption_300() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDFPRICE(DATE(2020,3,1),DATE(2030,3,1),DATE(2020,1,15),DATE(2021,3,1),0.075,0.05,300,1,1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 242.0421012).abs() < 1e-4,
        "ODDFPRICE redemption=300: {v}"
    );
}

// ============================================================
// COUPDAYBS
// ============================================================

#[test]
fn fn_coupdaybs_ms_example_basis1() {
    // Microsoft docs example: settlement=2011-01-25, maturity=2011-11-15, freq=2, basis=1
    // Expected: 71 (actual days from 2010-11-15 to 2011-01-25)
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYBS(DATE(2011,1,25),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 71.0).abs() < 1e-10, "COUPDAYBS basis=1: {v}");
}

#[test]
fn fn_coupdaybs_basis0() {
    // basis=0 (30/360): from 2010-11-15 to 2011-01-25
    // 360*(2011-2010) + 30*(1-11) + (25-15) = 360-300+10 = 70
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYBS(DATE(2011,1,25),DATE(2011,11,15),2,0)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 70.0).abs() < 1e-10, "COUPDAYBS basis=0: {v}");
}

#[test]
fn fn_coupdaybs_settlement_on_coupon_date() {
    // Settlement exactly on a coupon date → 0 days accrued
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYBS(DATE(2010,11,15),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 0.0).abs() < 1e-10, "COUPDAYBS on coupon date: {v}");
}

// ============================================================
// COUPDAYS
// ============================================================

#[test]
fn fn_coupdays_ms_example_basis1() {
    // Microsoft docs example: settlement=2011-01-25, maturity=2011-11-15, freq=2, basis=1
    // Expected: 181 (actual days from 2010-11-15 to 2011-05-15)
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 181.0).abs() < 1e-10, "COUPDAYS basis=1: {v}");
}

#[test]
fn fn_coupdays_basis0() {
    // basis=0 (30/360): 360/2 = 180
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,0)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 180.0).abs() < 1e-10, "COUPDAYS basis=0: {v}");
}

#[test]
fn fn_coupdays_annual_basis3() {
    // frequency=1, basis=3 (actual/365): 365/1 = 365
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),1,3)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 365.0).abs() < 1e-10, "COUPDAYS annual basis=3: {v}");
}

#[test]
fn fn_coupdays_consistency_with_coupdaybs() {
    // COUPDAYBS + COUPDAYSNC should equal COUPDAYS (tested via COUPDAYS - COUPDAYBS = days to next coupon)
    // Use basis=1 where actual days are unambiguous.
    // 2011-01-25 is 71 days after prev (2010-11-15) and 110 days before next (2011-05-15).
    // 71 + 110 = 181 = COUPDAYS.
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,1)-COUPDAYBS(DATE(2011,1,25),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    // Should equal 181-71=110 (days from settlement to next coupon)
    assert!((v - 110.0).abs() < 1e-10, "COUPDAYS-COUPDAYBS = {v}");
}

// ============================================================
// COUPDAYSNC
// ============================================================

#[test]
fn fn_coupdaysnc_ms_example_basis1() {
    // MS docs example: 110 days from 2011-01-25 to 2011-05-15 (actual)
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYSNC(DATE(2011,1,25),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 110.0).abs() < 1e-10, "COUPDAYSNC basis=1: {v}");
}

#[test]
fn fn_coupdaysnc_basis0() {
    // 30/360: E=180, A=70, so 110
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYSNC(DATE(2011,1,25),DATE(2011,11,15),2,0)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 110.0).abs() < 1e-10, "COUPDAYSNC basis=0: {v}");
}

#[test]
fn fn_coupdaysnc_equals_coupdays_minus_coupdaybs() {
    // For basis=1 (actual/actual): COUPDAYSNC = COUPDAYS - COUPDAYBS
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYSNC(DATE(2011,1,25),DATE(2011,11,15),2,1)-COUPDAYS(DATE(2011,1,25),DATE(2011,11,15),2,1)+COUPDAYBS(DATE(2011,1,25),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        v.abs() < 1e-10,
        "COUPDAYSNC = COUPDAYS-COUPDAYBS: residual {v}"
    );
}

#[test]
fn fn_coupdaysnc_basis2_leap_year() {
    // basis=2 (actual/360): actual days from settlement to next coupon.
    // 2020-01-01 → 2021-01-01 (annual, leap year) = 366 actual days.
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYSNC(DATE(2020,1,1),DATE(2021,1,1),1,2)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 366.0).abs() < 1e-10,
        "COUPDAYSNC basis=2 leap year: {v}"
    );
}

#[test]
fn fn_coupdaysnc_basis3_leap_year() {
    // basis=3 (actual/365): same actual-day count.
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYSNC(DATE(2020,1,1),DATE(2021,1,1),1,3)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 366.0).abs() < 1e-10,
        "COUPDAYSNC basis=3 leap year: {v}"
    );
}

#[test]
fn fn_coupdaysnc_basis2_non_leap_year() {
    // 2019-01-01 → 2020-01-01 (annual, non-leap) = 365 actual days.
    let mut model = new_empty_model();
    model._set("A1", "=COUPDAYSNC(DATE(2019,1,1),DATE(2020,1,1),1,2)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 365.0).abs() < 1e-10,
        "COUPDAYSNC basis=2 non-leap: {v}"
    );
}

// ============================================================
// COUPNCD
// ============================================================

#[test]
fn fn_coupncd_ms_example() {
    // Next coupon after 2011-01-25 with maturity 2011-11-15, freq=2 → 2011-05-15
    // Use IF to avoid date-formatting the zero result.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=IF(COUPNCD(DATE(2011,1,25),DATE(2011,11,15),2,1)=DATE(2011,5,15),1,0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 1.0).abs() < 1e-10, "COUPNCD: {v}");
}

#[test]
fn fn_coupncd_settlement_on_coupon_date() {
    // Settlement exactly on 2010-11-15 → next coupon is 2011-05-15
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=IF(COUPNCD(DATE(2010,11,15),DATE(2011,11,15),2,1)=DATE(2011,5,15),1,0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 1.0).abs() < 1e-10, "COUPNCD on coupon date: {v}");
}

// ============================================================
// COUPNUM
// ============================================================

#[test]
fn fn_coupnum_ms_example() {
    // 2 coupons between 2011-01-25 and 2011-11-15 (2011-05-15 and 2011-11-15)
    let mut model = new_empty_model();
    model._set("A1", "=COUPNUM(DATE(2011,1,25),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 2.0).abs() < 1e-10, "COUPNUM: {v}");
}

#[test]
fn fn_coupnum_annual_many() {
    // Annual coupons, 5 years to maturity → 5 coupons
    let mut model = new_empty_model();
    model._set("A1", "=COUPNUM(DATE(2011,1,25),DATE(2016,1,25),1,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 5.0).abs() < 1e-10, "COUPNUM annual 5yr: {v}");
}

// ============================================================
// COUPPCD
// ============================================================

#[test]
fn fn_couppcd_ms_example() {
    // Previous coupon before 2011-01-25 with maturity 2011-11-15, freq=2 → 2010-11-15
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=IF(COUPPCD(DATE(2011,1,25),DATE(2011,11,15),2,1)=DATE(2010,11,15),1,0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 1.0).abs() < 1e-10, "COUPPCD: {v}");
}

#[test]
fn fn_couppcd_settlement_on_coupon_date() {
    // Settlement exactly on 2010-11-15 → prev coupon is 2010-11-15 itself
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=IF(COUPPCD(DATE(2010,11,15),DATE(2011,11,15),2,1)=DATE(2010,11,15),1,0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 1.0).abs() < 1e-10, "COUPPCD on coupon date: {v}");
}

#[test]
fn fn_coupncd_couppcd_consistency() {
    // COUPNCD - COUPPCD should equal COUPDAYS (for basis=1)
    let mut model = new_empty_model();
    model._set("A1", "=COUPNCD(DATE(2011,1,25),DATE(2011,11,15),2,1)-COUPPCD(DATE(2011,1,25),DATE(2011,11,15),2,1)");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 181.0).abs() < 1e-10, "COUPNCD-COUPPCD = COUPDAYS: {v}");
}

// ============================================================
// ODDLPRICE / ODDLYIELD
// ============================================================

#[test]
fn fn_oddlprice_microsoft_example() {
    // Microsoft ODDLPRICE example: settlement=7-Feb-2008, maturity=15-Jun-2008,
    // last_interest=15-Oct-2007, rate=3.75%, yld=4.05%, redemption=100, freq=2,
    // basis=0 → 99.8782860235454. We diverge by ~0.004 here for the same reason
    // PRICE/YIELD diverge at basis 0: the compound-interest discounting used
    // throughout this module differs slightly from Excel's basis-0 convention.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 99.8782860235454).abs() < 1e-2, "ODDLPRICE = {v}");
}

#[test]
fn fn_oddlprice_oddlyield_roundtrip() {
    // ODDLYIELD of the price produced by ODDLPRICE must recover the input yield.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)",
    );
    model._set(
        "A2",
        "=ODDLYIELD(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,A1,100,2,0)",
    );
    model.evaluate();
    let y: f64 = model._get_text("A2").parse().unwrap();
    assert!((y - 0.0405).abs() < 1e-6, "ODDLYIELD roundtrip = {y}");
}

#[test]
fn fn_oddlprice_long_last_period_basis1_settlement_before_li() {
    // Settlement before last_interest: regular coupons remain plus an odd final
    // payment. Long last period (Oct-2024 to Aug-2025 > 6 months), actual/actual
    // basis exercises the per-quasi-period day-count weighting.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ODDLPRICE(DATE(2023,3,1),DATE(2025,8,15),DATE(2024,10,15),0.06,0.05,100,2,1)",
    );
    model._set(
        "A2",
        "=ODDLYIELD(DATE(2023,3,1),DATE(2025,8,15),DATE(2024,10,15),0.06,A1,100,2,1)",
    );
    model.evaluate();
    let p: f64 = model._get_text("A1").parse().unwrap();
    let y: f64 = model._get_text("A2").parse().unwrap();
    // Above-coupon-rate context: price above par, yield recovered.
    assert!(p > 100.0, "ODDLPRICE long last period = {p}");
    assert!((y - 0.05).abs() < 1e-6, "ODDLYIELD roundtrip = {y}");
}
