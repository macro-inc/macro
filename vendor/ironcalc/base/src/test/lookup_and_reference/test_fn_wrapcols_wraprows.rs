#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── WRAPCOLS ──────────────────────────────────────────────────────────────────

#[test]
fn test_wrapcols_basic() {
    let mut model = new_empty_model();
    // Column vector 1..6, wrap every 2 → 3 columns of 2 rows each
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("A6", "6");
    model._set("C1", "=WRAPCOLS(A1:A6,2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("C2"), "2");
    assert_eq!(model._get_text("D1"), "3");
    assert_eq!(model._get_text("D2"), "4");
    assert_eq!(model._get_text("E1"), "5");
    assert_eq!(model._get_text("E2"), "6");
}

#[test]
fn test_wrapcols_with_pad() {
    let mut model = new_empty_model();
    // 5 elements, wrap=2 → 3 columns, last column needs 1 pad
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("C1", "=WRAPCOLS(A1:A5,2,0)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("C2"), "2");
    assert_eq!(model._get_text("D1"), "3");
    assert_eq!(model._get_text("D2"), "4");
    assert_eq!(model._get_text("E1"), "5");
    assert_eq!(model._get_text("E2"), "0");
}

// ── WRAPROWS ──────────────────────────────────────────────────────────────────

#[test]
fn test_wraprows_basic() {
    let mut model = new_empty_model();
    // Column vector 1..6, wrap every 3 → 2 rows of 3 cols each
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("A6", "6");
    model._set("C1", "=WRAPROWS(A1:A6,3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("D1"), "2");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("C2"), "4");
    assert_eq!(model._get_text("D2"), "5");
    assert_eq!(model._get_text("E2"), "6");
}

#[test]
fn test_wraprows_with_pad() {
    let mut model = new_empty_model();
    // 5 elements, wrap=3 → 2 rows, last row padded with 0
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    model._set("C1", "=WRAPROWS(A1:A5,3,0)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("D1"), "2");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("C2"), "4");
    assert_eq!(model._get_text("D2"), "5");
    assert_eq!(model._get_text("E2"), "0");
}

#[test]
fn test_wraprows_2d_input_error() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("B1", "3");
    model._set("B2", "4");
    model._set("D1", "=WRAPROWS(A1:B2,2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "#VALUE!");
}
