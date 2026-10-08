#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── CHOOSECOLS ────────────────────────────────────────────────────────────────

#[test]
fn test_choosecols_basic() {
    let mut model = new_empty_model();
    // Build a 2×3 array in A1:C2
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "3");
    model._set("A2", "4");
    model._set("B2", "5");
    model._set("C2", "6");
    // Select columns 1 and 3
    model._set("E1", "=CHOOSECOLS(A1:C2,1,3)");
    model.evaluate();
    assert_eq!(model._get_text("E1"), "1");
    assert_eq!(model._get_text("F1"), "3");
    assert_eq!(model._get_text("E2"), "4");
    assert_eq!(model._get_text("F2"), "6");
}

#[test]
fn test_choosecols_negative_index() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "3");
    // -1 selects last column
    model._set("E1", "=CHOOSECOLS(A1:C1,-1)");
    model.evaluate();
    assert_eq!(model._get_text("E1"), "3");
}

#[test]
fn test_choosecols_out_of_range() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("E1", "=CHOOSECOLS(A1:B1,5)");
    model.evaluate();
    assert_eq!(model._get_text("E1"), "#VALUE!");
}

// ── CHOOSEROWS ────────────────────────────────────────────────────────────────

#[test]
fn test_chooserows_basic() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    // Select rows 1 and 3
    model._set("C1", "=CHOOSEROWS(A1:A3,1,3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("C2"), "3");
}

#[test]
fn test_chooserows_negative_index() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    // -1 selects last row
    model._set("C1", "=CHOOSEROWS(A1:A3,-1)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "30");
}

#[test]
fn test_chooserows_out_of_range() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("C1", "=CHOOSEROWS(A1:A2,5)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#VALUE!");
}
