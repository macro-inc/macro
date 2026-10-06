#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// =============================================================================
// Happy path
// =============================================================================

#[test]
fn fn_accrintm_microsoft_example() {
    // Source: Microsoft ACCRINTM documentation
    // Serials 39539 (2008-04-01) / 39614 (2008-06-15)
    // rate=0.1, par=1000, basis=3 (Actual/365), 75 days
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39539, 39614, 0.1, 1000, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"20.547945205");
}

#[test]
fn fn_accrintm_defaults() {
    // 3-arg form: par defaults to 1000, basis defaults to 0 (US 30/360)
    // Same date pair as microsoft_example, basis 0: 74 days / 360
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39539, 39614, 0.1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"20.555555556");
}

#[test]
fn fn_accrintm_all_bases() {
    // Source: P2 spec research, all 5 basis options with same date pair
    // 2024-01-15 to 2024-03-15, 60 actual calendar days, leap year 2024
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINTM(DATE(2024,1,15), DATE(2024,3,15), 0.1, 1000, 0)",
    );
    model._set(
        "A2",
        "=ACCRINTM(DATE(2024,1,15), DATE(2024,3,15), 0.1, 1000, 1)",
    );
    model._set(
        "A3",
        "=ACCRINTM(DATE(2024,1,15), DATE(2024,3,15), 0.1, 1000, 2)",
    );
    model._set(
        "A4",
        "=ACCRINTM(DATE(2024,1,15), DATE(2024,3,15), 0.1, 1000, 3)",
    );
    model._set(
        "A5",
        "=ACCRINTM(DATE(2024,1,15), DATE(2024,3,15), 0.1, 1000, 4)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"16.666666667"); // basis 0: 60/360
    assert_eq!(model._get_text("A2"), *"16.393442623"); // basis 1: 60/366 (leap)
    assert_eq!(model._get_text("A3"), *"16.666666667"); // basis 2: 60/360
    assert_eq!(model._get_text("A4"), *"16.438356164"); // basis 3: 60/365
    assert_eq!(model._get_text("A5"), *"16.666666667"); // basis 4: 60/360
}

// =============================================================================
// Error conditions
// =============================================================================

#[test]
fn fn_accrintm_error_issue_after_settlement() {
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39614, 39539, 0.1, 1000, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrintm_error_issue_equals_settlement() {
    // Boundary: same-day is error per Microsoft spec, not zero accrual
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39539, 39539, 0.1, 1000, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrintm_error_zero_rate() {
    // rate <= 0 → #NUM! (covers both zero and negative)
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39539, 39614, 0, 1000, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrintm_error_zero_par() {
    // par <= 0 → #NUM! (covers both zero and negative)
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39539, 39614, 0.1, 0, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrintm_error_invalid_basis() {
    // basis outside 0-4 → #NUM! (delegated to fn_yearfrac)
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39539, 39614, 0.1, 1000, 5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#NUM!");
}

#[test]
fn fn_accrintm_error_arg_count() {
    // Too few (2) and too many (6) arguments
    let mut model = new_empty_model();
    model._set("A1", "=ACCRINTM(39539, 39614)");
    model._set("A2", "=ACCRINTM(39539, 39614, 0.1, 1000, 3, 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}

// =============================================================================
// Day-count edge cases
// =============================================================================

#[test]
fn fn_accrintm_basis0_vs_basis4_month_end() {
    // Source: P2 spec research, Section 4
    // 2023-01-15 to 2023-03-31: the only scenario where US and EU 30/360 differ
    // Basis 0 (US): D1=15, D2=31 stays (D1<30). days=76. 76/360
    // Basis 4 (EU): D1=15, D2=31→30. days=75. 75/360
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINTM(DATE(2023,1,15), DATE(2023,3,31), 0.1, 1000, 0)",
    );
    model._set(
        "A2",
        "=ACCRINTM(DATE(2023,1,15), DATE(2023,3,31), 0.1, 1000, 4)",
    );
    model.evaluate();
    assert_ne!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A1"), *"21.111111111");
    assert_eq!(model._get_text("A2"), *"20.833333333");
}

#[test]
fn fn_accrintm_basis0_feb28_leap_vs_nonleap() {
    // Source: internet research (Christian Fries, MS-OI29500)
    // Same calendar date Feb 28 behaves differently in leap vs non-leap years
    // under basis 0 (US 30/360), because "last day of February" is leap-aware.
    // Non-leap 2023: Feb 28 IS last day → adjusted to "Feb 30", 105 days
    // Leap 2024: Feb 28 is NOT last day → no adjustment, D1=28, 107 days
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINTM(DATE(2023,2,28), DATE(2023,6,15), 0.1, 1000, 0)",
    );
    model._set(
        "A2",
        "=ACCRINTM(DATE(2024,2,28), DATE(2024,6,15), 0.1, 1000, 0)",
    );
    model.evaluate();
    assert_ne!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A1"), *"29.166666667"); // non-leap: 105/360
    assert_eq!(model._get_text("A2"), *"29.722222222"); // leap: 107/360
}

#[test]
fn fn_accrintm_cross_year_spanning_feb29() {
    // Source: internet research (MS Q&A thread, Procedure E analysis)
    // 2023-11-15 to 2024-03-15, basis 1: cross-year span where
    // is_feb_29_between_dates returns true (Feb 29 2024 within range) → /366
    // 121 actual days
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINTM(DATE(2023,11,15), DATE(2024,3,15), 0.1, 1000, 1)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"33.06010929");
}

#[test]
fn fn_accrintm_leap_feb28_to_mar1_contrast() {
    // Leap year: 2 actual days (Feb 28→29→Mar 1), /366
    // Non-leap: 1 actual day (Feb 28→Mar 1), /365
    // Basis 1 (Actual/Actual)
    let mut model = new_empty_model();
    model._set(
        "A1",
        "=ACCRINTM(DATE(2024,2,28), DATE(2024,3,1), 0.1, 1000, 1)",
    );
    model._set(
        "A2",
        "=ACCRINTM(DATE(2023,2,28), DATE(2023,3,1), 0.1, 1000, 1)",
    );
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.546448087"); // 2/366
    assert_eq!(model._get_text("A2"), *"0.273972603"); // 1/365
}
