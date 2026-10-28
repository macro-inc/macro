#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── TOCOL ─────────────────────────────────────────────────────────────────────

#[test]
fn tocol_2d_to_column() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    model._set("C1", "=TOCOL(A1:B2)");
    model.evaluate();
    // row-by-row: 1, 2, 3, 4
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("C2"), "2");
    assert_eq!(model._get_text("C3"), "3");
    assert_eq!(model._get_text("C4"), "4");
    assert_eq!(model._get_text("C5"), "");
}

#[test]
fn tocol_scan_by_col() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    model._set("C1", "=TOCOL(A1:B2,0,TRUE)");
    model.evaluate();
    // col-by-col: 1, 3, 2, 4
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("C2"), "3");
    assert_eq!(model._get_text("C3"), "2");
    assert_eq!(model._get_text("C4"), "4");
}

#[test]
fn tocol_single_column_unchanged() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("A3", "30");
    model._set("B1", "=TOCOL(A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "10");
    assert_eq!(model._get_text("B2"), "20");
    assert_eq!(model._get_text("B3"), "30");
}

// ── TOROW ─────────────────────────────────────────────────────────────────────

#[test]
fn torow_2d_to_row() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    model._set("C1", "=TOROW(A1:B2)");
    model.evaluate();
    // row-by-row: 1, 2, 3, 4
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("D1"), "2");
    assert_eq!(model._get_text("E1"), "3");
    assert_eq!(model._get_text("F1"), "4");
    assert_eq!(model._get_text("G1"), "");
}

#[test]
fn torow_scan_by_col() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    model._set("C1", "=TOROW(A1:B2,0,TRUE)");
    model.evaluate();
    // col-by-col: 1, 3, 2, 4
    assert_eq!(model._get_text("C1"), "1");
    assert_eq!(model._get_text("D1"), "3");
    assert_eq!(model._get_text("E1"), "2");
    assert_eq!(model._get_text("F1"), "4");
}

#[test]
fn torow_single_row_unchanged() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("B1", "20");
    model._set("C1", "30");
    model._set("A2", "=TOROW(A1:C1)");
    model.evaluate();
    assert_eq!(model._get_text("A2"), "10");
    assert_eq!(model._get_text("B2"), "20");
    assert_eq!(model._get_text("C2"), "30");
}
