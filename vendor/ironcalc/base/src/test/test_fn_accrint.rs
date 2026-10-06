#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_average_accrint_simple_cases() {
    let mut model = new_empty_model();
    // ACCRINT(issue, first_interest, settlement, rate, par, frequency, [basis], [calc_method])
    model._set("A1", "=ACCRINT(39508, 39691, 39569, 0.1, 1000, 2, 0)");
    model._set(
        "A2",
        "=ACCRINT(DATE(2008, 3, 5), 39691, 39569, 0.1, 1000, 2, 0, FALSE)",
    );
    model._set(
        "A3",
        "=ACCRINT(DATE(2008, 4, 5), 39691, 39569, 0.1, 1000, 2, 0, TRUE)",
    );
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"16.666666667");
    assert_eq!(model._get_text("A2"), *"15.555555556");
    assert_eq!(model._get_text("A3"), *"7.222222222");
}

// DAX canonical worked example
// (https://learn.microsoft.com/en-us/dax/accrint-function-dax):
//
//   ACCRINT(DATE(2007,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0)
//     -> 116.944444444444
//
//   ACCRINT(DATE(2007,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0, FALSE)
//     -> 66.9444444444445
//
// These values exercise the multi-period accrual (NC = 3) because the
// settlement falls inside the third quasi-coupon period after issue.
#[test]
fn fn_accrint_dax_canonical() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2007,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0)",
    );
    model._set(
        "A2",
        "=ACCRINT(DATE(2007,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0, FALSE)",
    );
    model.evaluate();

    let a1 = model._get_text("A1");
    let a2 = model._get_text("A2");

    // Verify within standard floating-point tolerance: parse and compare.
    let a1_val: f64 = a1.parse().unwrap();
    let a2_val: f64 = a2.parse().unwrap();
    assert!(
        (a1_val - 116.944_444_444_444).abs() < 1e-6,
        "A1 (calc_method=TRUE default) = {a1}, expected 116.944444444444"
    );
    assert!(
        (a2_val - 66.944_444_444_445).abs() < 1e-6,
        "A2 (calc_method=FALSE) = {a2}, expected 66.9444444444445"
    );
}

// Settlement equals coupon date: returns the full-period accrual.
#[test]
fn fn_accrint_settlement_equals_coupon() {
    let mut model = new_empty_model();
    // Issue 2008-3-1, first_interest 2008-9-1, settlement 2008-9-1
    // (= first_interest, the next coupon date). Excel and LibreOffice
    // misbehave on this case; IronCalc returns 0.
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,9,1), 0.1, 1000, 2, 0)",
    );
    model.evaluate();
    let a1 = model._get_text("A1");
    let a1_val: f64 = a1.parse().unwrap();
    // Issue→settlement is exactly one full period, sum = 1.0,
    // AI = 1000 * 0.05 * 1.0 = 50. The "settlement = next coupon"
    // case is the boundary where one full coupon has accrued.
    assert!(
        (a1_val - 50.0).abs() < 1e-6,
        "A1 (settlement=first_interest) = {a1}, expected 50.0"
    );
}

// ---------------------------------------------------------------------
// Error conditions
//
// MS spec (https://support.microsoft.com/en-us/office/accrint-function):
//   ACCRINT returns the #NUM! error value when:
//     - rate <= 0
//     - par <= 0
//     - frequency is any number other than 1, 2, or 4
//     - basis < 0 or basis > 4
//     - issue >= settlement
// ---------------------------------------------------------------------

#[test]
fn fn_accrint_error_rate_zero() {
    let mut model = new_empty_model();
    // rate = 0 → #NUM!
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0, 1000, 2, 0)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrint_error_rate_negative() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), -0.05, 1000, 2, 0)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrint_error_par_zero() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 0, 2, 0)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrint_error_par_negative() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, -100, 2, 0)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrint_error_frequency_invalid() {
    let mut model = new_empty_model();
    // frequency must be 1, 2, or 4. Test 3 and 5.
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 3, 0)",
    );
    model._set(
        "A2",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 5, 0)",
    );
    model._set(
        "A3",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 0, 0)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
    assert_eq!(model._get_text("A3"), *"#NUM!");
}

#[test]
fn fn_accrint_error_basis_out_of_range() {
    let mut model = new_empty_model();
    // basis must be 0..=4.
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 2, -1)",
    );
    model._set(
        "A2",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 2, 5)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
}

#[test]
fn fn_accrint_error_issue_after_settlement() {
    let mut model = new_empty_model();
    // issue > settlement
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,9,1), DATE(2009,3,1), DATE(2008,5,1), 0.1, 1000, 2, 0)",
    );
    // issue = settlement
    model._set(
        "A2",
        "=ACCRINT(DATE(2008,5,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 2, 0)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
}

#[test]
fn fn_accrint_error_args_count() {
    let mut model = new_empty_model();
    // Too few (5 args)
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000)",
    );
    // Too many (9 args)
    model._set(
        "A2",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 2, 0, TRUE, 99)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}

// ---------------------------------------------------------------------
// Basis variation, single-period base case
//
// All tests use issue 2020-1-1 (= previous coupon, day-of-month=1
// avoids 30/360 month-end edge cases), first_interest = CPNDT_1 =
// 2020-7-1, settlement 2020-3-1, semi-annual, rate 0.10, par 1000.
//
// Day count from issue 2020-1-1 to settlement 2020-3-1:
//   30/360 (US, basis 0)        : 60 days
//   Actual/Actual (basis 1)     : 60 days (Jan 31 + Feb 29 leap)
//   Actual/360 (basis 2)        : 60 days
//   Actual/365 (basis 3)        : 60 days
//   30/360 European (basis 4)   : 60 days
// Period length 2020-1-1 to 2020-7-1:
//   30/360 / European           : 180 days
//   Actual/Actual / Actual/365  : 182 days (Jan 31 + Feb 29 + Mar 31 + Apr 30 + May 31 + Jun 30 = 182)
//   Actual/360                  : year frac uses 360 denominator
//
// AI = par * rate / freq * (A_1 / NL_1)
//   basis 0 / 4 : 1000 * 0.05 * 60 / 180 = 16.66666...
//   basis 1     : 1000 * 0.05 * 60 / 182 = 16.48351...
//   basis 2 / 3 : same numerator, but day_count_basis returns
//                 yearfrac * 360 (for basis 2) which gives a
//                 different ratio. Verified empirically below.
// ---------------------------------------------------------------------

#[test]
fn fn_accrint_basis_0_us_30_360() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2020,7,1), DATE(2020,3,1), 0.1, 1000, 2, 0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    // 60 / 180 * 50 = 16.6666...
    assert!(
        (v - 16.666_666_666_667).abs() < 1e-6,
        "basis 0 = {v}, expected ~16.6667"
    );
}

#[test]
fn fn_accrint_basis_4_european_30_360() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2020,7,1), DATE(2020,3,1), 0.1, 1000, 2, 4)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    // European 30/360 also gives 60 / 180 * 50 = 16.6667 for these inputs
    // (no day-31 boundaries in 2020-1-1 → 2020-7-1 to differ from US).
    assert!(
        (v - 16.666_666_666_667).abs() < 1e-6,
        "basis 4 = {v}, expected ~16.6667"
    );
}

#[test]
fn fn_accrint_mayle_v2_benchmark_13() {
    // Mayle V2 Benchmark #13 (corporate bond, semi-annual, 30/360):
    //   previous coupon 2020-12-15, CPNDT_1 2021-6-15, settlement 2021-2-25,
    //   rate 5.875%, par 100, basis 0 (US 30/360).
    //   A = 70 days, NL = 180 days, accrued = 70/180 * 5.875/2 = 1.142361.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,12,15), DATE(2021,6,15), DATE(2021,2,25), 0.05875, 100, 2, 0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 1.142_361_111).abs() < 1e-6,
        "Mayle V2 Benchmark #13 = {v}, expected 1.142361"
    );
}

#[test]
fn fn_accrint_frequency_annual() {
    // Annual coupon, basis 0, single period.
    // Issue 2020-1-1, first_interest 2021-1-1, settlement 2020-7-1.
    // 30/360 days from issue to settlement: 180.
    // Period length: 360.
    // AI = par * rate * (180/360) = 1000 * 0.1 * 0.5 = 50.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2021,1,1), DATE(2020,7,1), 0.1, 1000, 1, 0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 50.0).abs() < 1e-6,
        "annual frequency = {v}, expected 50.0"
    );
}

#[test]
fn fn_accrint_frequency_quarterly() {
    // Quarterly coupon, basis 0.
    // Issue 2020-1-1, first_interest 2020-4-1, settlement 2020-3-1.
    // 30/360 days: issue→settlement = 60, period = 90.
    // AI = par * (rate/4) * (60/90) = 1000 * 0.025 * 0.6666 = 16.6666.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2020,4,1), DATE(2020,3,1), 0.1, 1000, 4, 0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 16.666_666_666_667).abs() < 1e-6,
        "quarterly frequency = {v}, expected ~16.6667"
    );
}

#[test]
fn fn_accrint_calc_method_omitted_defaults_true() {
    // Verify that omitting calc_method gives the same result as TRUE.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2007,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0)",
    );
    model._set(
        "A2",
        "=ACCRINT(DATE(2007,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0, TRUE)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    let a2: f64 = model._get_text("A2").parse().unwrap();
    assert!(
        (a1 - a2).abs() < 1e-9,
        "calc_method default ({a1}) should equal TRUE explicit ({a2})"
    );
}

#[test]
fn fn_accrint_basis_1_actual_actual_probe() {
    // Probe what IronCalc returns for basis 1 (Actual/Actual) on the
    // single-period case, then assert that value. This pins behavior;
    // the value should also match Excel and Mayle V1 Benchmark #3a
    // (Treasury Act/Act).
    //
    // For issue 2020-1-1, first_interest 2020-7-1, settlement 2020-3-1:
    //   Actual days from 2020-1-1 to 2020-3-1 = 60 (Jan 31 + Feb 29 leap)
    //   Period 2020-1-1 to 2020-7-1 actual = 182
    //   AI = 1000 * 0.05 * (60/182) = 16.483516...
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2020,7,1), DATE(2020,3,1), 0.1, 1000, 2, 1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 16.483_516_483_5).abs() < 1e-6,
        "basis 1 = {v}, expected ~16.4835 (60/182 * 50)"
    );
}

#[test]
fn fn_accrint_basis_2_actual_360() {
    // basis 2 = Actual/360. Numerator = actual days; NLᵢ = 360/freq = 180.
    // Issue 2020-1-1 to settlement 2020-3-1: 60 actual days (2020 leap).
    // Single period (NC = 1), so no odd-long-coupon offset.
    // AI = 1000 * (0.1/2) * (60 / 180) = 16.666666... (Excel-verified).
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2020,7,1), DATE(2020,3,1), 0.1, 1000, 2, 2)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 16.666_666_667).abs() < 1e-6,
        "basis 2 = {v}, expected ~16.6667 (60/180 * 50, NLᵢ = 360/freq)"
    );
}

#[test]
fn fn_accrint_basis_3_actual_365() {
    // basis 3 = Actual/365. Numerator = actual days; NLᵢ = 365/freq = 182.5.
    // Issue 2020-1-1 to settlement 2020-3-1: 60 actual days (2020 leap).
    // Single period (NC = 1), so no odd-long-coupon offset.
    // AI = 1000 * (0.1/2) * (60 / 182.5) = 16.438356... (Excel-verified).
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2020,7,1), DATE(2020,3,1), 0.1, 1000, 2, 3)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 16.438_356_164).abs() < 1e-6,
        "basis 3 = {v}, expected ~16.4384 (60/182.5 * 50, NLᵢ = 365/freq)"
    );
}

#[test]
fn fn_accrint_leap_year_february() {
    // Leap-year boundary case: settlement on Feb 29 inside a leap year.
    // Issue 2020-1-1, first_interest 2020-7-1, settlement 2020-2-29.
    // Under basis 1 (Actual/Actual):
    //   actual days from 2020-1-1 to 2020-2-29 = 59
    //   period 2020-1-1 to 2020-7-1 actual = 182
    //   AI = 1000 * 0.05 * 59/182 = 16.208791...
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2020,1,1), DATE(2020,7,1), DATE(2020,2,29), 0.1, 1000, 2, 1)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 16.208_791_208_8).abs() < 1e-6,
        "leap year Feb 29 settlement = {v}, expected ~16.2088 (59/182 * 50)"
    );
}

#[test]
fn fn_accrint_month_end_first_interest() {
    // First_interest on the last day of a month with 31 days, semi-annual.
    // Issue 2008-2-29, first_interest 2008-8-31 (last day of Aug),
    // settlement 2008-5-1.
    // Under basis 0 (US 30/360, IronCalc days360):
    //   issue 2008-2-29 = last day of Feb of leap year, sd_day → 30
    //   ed_day=1, no adjustment, days(2008-2-29 → 2008-5-1) = 0+3*30+(1-30) = 61
    //   period 2008-2-29 → 2008-8-31: sd_day → 30, ed_day=31 with sd≥30 → 30,
    //     days = 0 + 6*30 + 0 = 180
    //   sum = 61 / 180
    //   AI = 1000 * 0.05 * 61/180 = 16.944444...
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,2,29), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (v - 16.944_444_444_4).abs() < 1e-6,
        "month-end first_interest = {v}, expected ~16.9444 (61/180 * 50)"
    );
}

#[test]
fn fn_accrint_calc_method_false_on_dax_canonical() {
    // Standalone test for the DAX FALSE case to make the calc_method
    // divergence explicit (also covered in fn_accrint_dax_canonical).
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2007,3,1), DATE(2008,8,31), DATE(2008,5,1), 0.1, 1000, 2, 0, FALSE)",
    );
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    // 66.9444... = AI_TRUE - 50 (one full period dropped from sum)
    assert!(
        (v - 66.944_444_444_4).abs() < 1e-6,
        "DAX FALSE = {v}, expected ~66.9444"
    );
}

#[test]
fn fn_accrint_basis_omitted_defaults_zero() {
    // Verify that omitting basis gives the same result as basis 0.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 2)",
    );
    model._set(
        "A2",
        "=ACCRINT(DATE(2008,3,1), DATE(2008,9,1), DATE(2008,5,1), 0.1, 1000, 2, 0)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    let a2: f64 = model._get_text("A2").parse().unwrap();
    assert!(
        (a1 - a2).abs() < 1e-9,
        "basis default ({a1}) should equal basis 0 explicit ({a2})"
    );
}

// ---------------------------------------------------------------------
// Oracle tests for the multi-period (multiple quasi-coupon) accrual,
// with dates drawn from the upstream xlsx fixture (ACCRINT_ACCRINTM.xlsx,
// commit ff5be2f5) and values cross-checked in Excel.
// ---------------------------------------------------------------------

// ACCRINT(39508, 39691, 39569, 0.1, 1000, 4): issue 2008-03-01,
// first_interest 2008-08-31, settlement 2008-05-01. At freq=4 the
// quarterly quasi-coupon boundaries are walked back from first_interest,
// giving a different A/NL ratio than the freq=1/freq=2 single-period case
// (both 16.66666667).
#[test]
fn fn_accrint_xlsx_oracle_i5_freq4_default_basis() {
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINT(39508, 39691, 39569, 0.1, 1000, 4)");
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 16.944_444_444_444).abs() < 1e-6,
        "I5 freq=4 default basis = {a1}, expected 16.944444444444"
    );
}

// K7: ACCRINT(2017-01-01, 2017-12-01, 2017-04-01, 0.33, 3000, 2,
// 0, FALSE). Excel returns 247.5 (equal to the calc_method=TRUE
// result for the same inputs). At freq=2 with these dates,
// calc_method=FALSE has no observable effect because the
// trimmed-after-first-period sum still covers the full accrual.
#[test]
fn fn_accrint_xlsx_oracle_k7_calc_false_freq2_short_span() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2017,1,1), DATE(2017,12,1), DATE(2017,4,1), 0.33, 3000, 2, 0, FALSE)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 247.5).abs() < 1e-6,
        "K7 freq=2 basis=0 calc_method=FALSE = {a1}, expected 247.5"
    );
}

// J8-J11: ACCRINT(2017-01-01, 2017-12-01, 2017-04-01, 0.33, 3000,
// 4, basis) for basis in {1, 2, 3, 4}. Each basis yields its own
// accrued-interest value, matching Excel.
#[test]
fn fn_accrint_xlsx_oracle_j8_freq4_basis1() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2017,1,1), DATE(2017,12,1), DATE(2017,4,1), 0.33, 3000, 4, 1)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 241.123_626_4).abs() < 1e-6,
        "J8 freq=4 basis=1 = {a1}, expected 241.1236264"
    );
}

#[test]
fn fn_accrint_xlsx_oracle_j9_freq4_basis2() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2017,1,1), DATE(2017,12,1), DATE(2017,4,1), 0.33, 3000, 4, 2)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 236.5).abs() < 1e-6,
        "J9 freq=4 basis=2 = {a1}, expected 236.5"
    );
}

#[test]
fn fn_accrint_xlsx_oracle_j10_freq4_basis3() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2017,1,1), DATE(2017,12,1), DATE(2017,4,1), 0.33, 3000, 4, 3)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 240.041_095_9).abs() < 1e-6,
        "J10 freq=4 basis=3 = {a1}, expected 240.0410959"
    );
}

#[test]
fn fn_accrint_xlsx_oracle_j11_freq4_basis4() {
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2017,1,1), DATE(2017,12,1), DATE(2017,4,1), 0.33, 3000, 4, 4)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 247.5).abs() < 1e-6,
        "J11 freq=4 basis=4 = {a1}, expected 247.5"
    );
}

// ---------------------------------------------------------------------
// Cross-frequency oracle tests for the odd-long-first-coupon settlement
// numerator. The J8-J11 block above is freq=4 only; these pin the
// generalization to freq=2 and exercise the Actual/Actual (basis 1)
// "regular coupon length" normalization, where the settlement period is
// normalized by the LAST quasi-coupon period's actual length, not its
// own. Values cross-checked in Excel.
// ---------------------------------------------------------------------

#[test]
fn fn_accrint_freq2_oddlong_basis2() {
    // issue 2016-6-1, first_interest 2017-12-1 (NC=3 at freq 2), settle 2016-9-1.
    // Interior periods (Jun1-16->Dec1-16 = 183d, Dec1-16->Jun1-17 = 182d) drift
    // vs NLᵢ = 360/2 = 180: offset = 3 + 2 = 5. Settlement slice = 92 actual days
    // -> 87/180. AI = 3000 * 0.165 * 87/180 = 239.25.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2016,6,1), DATE(2017,12,1), DATE(2016,9,1), 0.33, 3000, 2, 2)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 239.25).abs() < 1e-6,
        "freq=2 odd-long basis=2 = {a1}, expected 239.25"
    );
}

#[test]
fn fn_accrint_freq2_oddlong_basis3() {
    // Same dates, basis 3 (Actual/365). NLᵢ = 365/2 = 182.5; interior drift
    // = 0.5 - 0.5 = 0, so settlement numerator = 92 actual days -> 92/182.5.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2016,6,1), DATE(2017,12,1), DATE(2016,9,1), 0.33, 3000, 2, 3)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 249.534_247).abs() < 1e-4,
        "freq=2 odd-long basis=3 = {a1}, expected ~249.5342"
    );
}

#[test]
fn fn_accrint_freq2_oddlong_basis1_last_period_normalization() {
    // basis 1 (Actual/Actual): the settlement period is normalized by the LAST
    // quasi-coupon period's actual length (NL_ref = Jun1-17->Dec1-17 = 183),
    // NOT the settlement period's own length. Offset = (183-183) + (182-183)
    // = -1, so settlement numerator = 92 - (-1) = 93 -> 93/183. Excel = 251.5574.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2016,6,1), DATE(2017,12,1), DATE(2016,9,1), 0.33, 3000, 2, 1)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 251.557_377).abs() < 1e-4,
        "freq=2 odd-long basis=1 = {a1}, expected ~251.5574"
    );
}

#[test]
fn fn_accrint_freq4_nc2_basis1() {
    // basis 1, NC=2 odd-long: issue 2017-6-1, first_interest 2017-12-1,
    // settle 2017-7-1. NL_ref = last period Sep1->Dec1 = 91; one interior
    // period (Jun1->Sep1 = 92) -> offset = 1. Settlement slice = 30 actual
    // days -> 29/91. Excel = 78.87363.
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINT(DATE(2017,6,1), DATE(2017,12,1), DATE(2017,7,1), 0.33, 3000, 4, 1)",
    );
    model.evaluate();
    let a1: f64 = model._get_text("A1").parse().unwrap();
    assert!(
        (a1 - 78.873_626).abs() < 1e-4,
        "freq=4 NC=2 basis=1 = {a1}, expected ~78.87363"
    );
}
