#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── HSTACK ────────────────────────────────────────────────────────────────────

#[test]
fn test_hstack_two_columns() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("B1", "3");
    model._set("B2", "4");
    model._set("D1", "=HSTACK(A1:A2,B1:B2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("D2"), "2");
    assert_eq!(model._get_text("E2"), "4");
}

#[test]
fn test_hstack_unequal_rows() {
    let mut model = new_empty_model();
    // Column A has 2 rows, column B has 1 row → row 2 of B padded with #N/A
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("B1", "3");
    model._set("D1", "=HSTACK(A1:A2,B1:B1)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("D2"), "2");
    assert_eq!(model._get_text("E2"), "#N/A");
}

// ── VSTACK ────────────────────────────────────────────────────────────────────

#[test]
fn test_vstack_two_rows() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    model._set("D1", "=VSTACK(A1:B1,A2:B2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("E1"), "2");
    assert_eq!(model._get_text("D2"), "3");
    assert_eq!(model._get_text("E2"), "4");
}

#[test]
fn test_vstack_unequal_cols() {
    let mut model = new_empty_model();
    // Row 1 has 2 cols, row 2 has 1 col → col 2 of row 2 padded with #N/A
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("D1", "=VSTACK(A1:B1,A2:A2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "1");
    assert_eq!(model._get_text("E1"), "2");
    assert_eq!(model._get_text("D2"), "3");
    assert_eq!(model._get_text("E2"), "#N/A");
}
