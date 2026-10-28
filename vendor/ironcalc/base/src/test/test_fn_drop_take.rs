#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── TAKE ──────────────────────────────────────────────────────────────────────

#[test]
fn take_first_rows() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=TAKE(A1:A3,2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("B2"), "2");
    assert_eq!(model._get_text("B3"), "");
}

#[test]
fn take_last_rows_negative() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=TAKE(A1:A3,-2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("B2"), "3");
    assert_eq!(model._get_text("B3"), "");
}

#[test]
fn take_rows_exceeds_array_size() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("B1", "=TAKE(A1:A2,5)");
    model.evaluate();
    // returns all 2 rows
    assert_eq!(model._get_text("B1"), "10");
    assert_eq!(model._get_text("B2"), "20");
}

#[test]
fn take_first_cols() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "3");
    model._set("D1", "=TAKE(A1:C1,1,2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("E1"), "2");
    assert_eq!(model._get_text("F1"), "");
}

#[test]
fn take_last_cols_negative() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "3");
    model._set("D1", "=TAKE(A1:C1,1,-2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "2");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("F1"), "");
}

#[test]
fn take_zero_rows_is_error() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "=TAKE(A1:A3,0)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#CALC!");
}

// ── DROP ──────────────────────────────────────────────────────────────────────

#[test]
fn drop_first_rows() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=DROP(A1:A3,1)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("B2"), "3");
    assert_eq!(model._get_text("B3"), "");
}

#[test]
fn drop_last_rows_negative() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=DROP(A1:A3,-1)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("B2"), "2");
    assert_eq!(model._get_text("B3"), "");
}

#[test]
fn drop_all_rows_returns_calc_error() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("B1", "=DROP(A1:A2,2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#CALC!");
}

#[test]
fn drop_zero_rows_returns_full_array() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=DROP(A1:A3,0)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1");
    assert_eq!(model._get_text("B2"), "2");
    assert_eq!(model._get_text("B3"), "3");
}

#[test]
fn drop_first_cols() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "3");
    model._set("D1", "=DROP(A1:C1,0,1)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "2");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("F1"), "");
}
