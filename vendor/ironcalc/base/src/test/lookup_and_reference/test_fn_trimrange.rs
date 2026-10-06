#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── trim both edges (default) ─────────────────────────────────────────────────

#[test]
fn test_trimrange_default_trims_leading_and_trailing_rows() {
    let mut model = new_empty_model();
    // Row 1 blank, rows 2-3 have data, row 4 blank
    model._set("A2", "10");
    model._set("A3", "20");
    // Default trim_rows=3, trim_cols=3
    model._set("C1", "=TRIMRANGE(A1:A4)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "10");
    assert_eq!(model._get_text("C2"), "20");
    // C3 should be empty (result is only 2 rows)
    assert_eq!(model._get_text("C3"), "");
}

#[test]
fn test_trimrange_default_trims_leading_and_trailing_cols() {
    let mut model = new_empty_model();
    // Column A blank, column B has data, column C blank
    model._set("B1", "hello");
    model._set("D1", "=TRIMRANGE(A1:C1)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "hello");
    // E1 should be empty (result is just 1 column)
    assert_eq!(model._get_text("E1"), "");
}

// ── trim_rows mode ────────────────────────────────────────────────────────────

#[test]
fn test_trimrange_trim_rows_none() {
    let mut model = new_empty_model();
    model._set("A2", "42");
    // trim_rows=0: no row trimming → still 3 rows in result.
    // Blank cells in spilled arrays render as "0" in IronCalc.
    model._set("C1", "=TRIMRANGE(A1:A3,0,0)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "0"); // blank row kept (renders as 0)
    assert_eq!(model._get_text("C2"), "42");
    assert_eq!(model._get_text("C3"), "0"); // blank row kept (renders as 0)
}

#[test]
fn test_trimrange_trim_leading_rows_only() {
    let mut model = new_empty_model();
    model._set("A2", "5");
    model._set("A3", "6");
    // trim_rows=1: only leading blank row removed
    model._set("C1", "=TRIMRANGE(A1:A3,1,0)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "5");
    assert_eq!(model._get_text("C2"), "6");
}

#[test]
fn test_trimrange_trim_trailing_rows_only() {
    let mut model = new_empty_model();
    model._set("A1", "7");
    model._set("A2", "8");
    // row 3 is blank — trim_rows=2 trims it
    model._set("C1", "=TRIMRANGE(A1:A3,2,0)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "7");
    assert_eq!(model._get_text("C2"), "8");
    assert_eq!(model._get_text("C3"), "");
}

// ── interior blanks are preserved ─────────────────────────────────────────────

#[test]
fn test_trimrange_preserves_interior_blank_rows() {
    let mut model = new_empty_model();
    model._set("A1", "start");
    // A2 intentionally blank (interior)
    model._set("A3", "end");
    model._set("C1", "=TRIMRANGE(A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "start");
    assert_eq!(model._get_text("C2"), "0"); // interior blank preserved (renders as 0)
    assert_eq!(model._get_text("C3"), "end");
}

// ── fully blank range → #REF! ─────────────────────────────────────────────────

#[test]
fn test_trimrange_all_blank_returns_ref_error() {
    let mut model = new_empty_model();
    // A1:A3 all blank
    model._set("C1", "=TRIMRANGE(A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#REF!");
}

// ── 2-D trimming ──────────────────────────────────────────────────────────────

#[test]
fn test_trimrange_2d_trims_rows_and_cols() {
    let mut model = new_empty_model();
    // Row 1 and column A are blank; data starts at B2
    model._set("B2", "1");
    model._set("C2", "2");
    model._set("B3", "3");
    model._set("C3", "4");
    model._set("E1", "=TRIMRANGE(A1:C3)");
    model.evaluate();
    assert_eq!(model._get_text("E1"), "1");
    assert_eq!(model._get_text("F1"), "2");
    assert_eq!(model._get_text("E2"), "3");
    assert_eq!(model._get_text("F2"), "4");
}
