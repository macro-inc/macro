#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    // Day 9 Dec 2025 = serial number 46000, Tuesday, week 50
    model._set("A1", "=WEEKDAY()");
    model._set("A2", "=WEEKDAY(46000)");
    model._set("A3", "=WEEKDAY(46000, 11)");
    model._set("A4", "=WEEKDAY(46000, 11, 2)");

    model._set("B1", "=WEEKNUM()");
    model._set("B2", "=WEEKNUM(46000)");
    model._set("B3", "=WEEKNUM(46000, 11)");
    model._set("B4", "=WEEKNUM(46000, 11, 2)");

    model._set("C1", "=ISOWEEKNUM()");
    model._set("C2", "=ISOWEEKNUM(46000)");
    model._set("C3", "=ISOWEEKNUM(46000, 11)");
    model._set("C4", "=ISOWEEKNUM(46000, 11, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"3");
    assert_eq!(model._get_text("A3"), *"2");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"50");
    assert_eq!(model._get_text("B3"), *"50");
    assert_eq!(model._get_text("B4"), *"#ERROR!");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"50");
    assert_eq!(model._get_text("C3"), *"#ERROR!");
    assert_eq!(model._get_text("C4"), *"#ERROR!");
}

// WEEKDAY and ISOWEEKNUM broadcast element-wise over a range/array, spilling the
// result. A single-cell/scalar argument keeps returning a scalar.
#[test]
fn weekday_isoweeknum_broadcast_over_range() {
    let mut model = new_empty_model();
    // 2024-01-01 (Mon, serial 45292), 2024-01-02 (Tue), 2024-01-07 (Sun)
    model._set("A1", "45292");
    model._set("A2", "45293");
    model._set("A3", "45298");

    // WEEKDAY, default return_type (Sunday = 1)
    model._set("C1", "=WEEKDAY(A1:A3)");
    // WEEKDAY with return_type 2 (Monday = 1)
    model._set("D1", "=WEEKDAY(A1:A3, 2)");
    // ISOWEEKNUM
    model._set("E1", "=ISOWEEKNUM(A1:A3)");

    model.evaluate();

    assert_eq!(model._get_text("C1"), "2"); // Monday
    assert_eq!(model._get_text("C2"), "3"); // Tuesday
    assert_eq!(model._get_text("C3"), "1"); // Sunday

    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("D2"), "2");
    assert_eq!(model._get_text("D3"), "7");

    assert_eq!(model._get_text("E1"), "1");
    assert_eq!(model._get_text("E2"), "1");
    assert_eq!(model._get_text("E3"), "1");

    // Scalars still return a single value (no spill).
    model._set("G1", "=WEEKDAY(45292)");
    model._set("G2", "=ISOWEEKNUM(45292)");
    model.evaluate();
    assert_eq!(model._get_text("G1"), "2");
    assert_eq!(model._get_text("G2"), "1");
}
