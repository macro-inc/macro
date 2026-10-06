#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── ADDRESS ───────────────────────────────────────────────────────────────────

#[test]
fn test_address_absolute() {
    let mut model = new_empty_model();
    model._set("A1", "=ADDRESS(1,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "$A$1");
}

#[test]
fn test_address_row_abs_col_rel() {
    let mut model = new_empty_model();
    model._set("A1", "=ADDRESS(3,5,2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "E$3");
}

#[test]
fn test_address_row_rel_col_abs() {
    let mut model = new_empty_model();
    model._set("A1", "=ADDRESS(3,5,3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "$E3");
}

#[test]
fn test_address_relative() {
    let mut model = new_empty_model();
    model._set("A1", "=ADDRESS(3,5,4)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "E3");
}

#[test]
fn test_address_with_sheet() {
    let mut model = new_empty_model();
    model._set("A1", r#"=ADDRESS(1,1,1,TRUE,"Sheet1")"#);
    model.evaluate();
    assert_eq!(model._get_text("A1"), "Sheet1!$A$1");
}

#[test]
fn test_address_r1c1_absolute() {
    let mut model = new_empty_model();
    model._set("A1", "=ADDRESS(3,5,1,FALSE)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "R3C5");
}

#[test]
fn test_address_r1c1_relative() {
    let mut model = new_empty_model();
    model._set("A1", "=ADDRESS(3,5,4,FALSE)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "R[3]C[5]");
}

#[test]
fn test_address_large_column() {
    let mut model = new_empty_model();
    model._set("A1", "=ADDRESS(1,27)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "$AA$1");
}

#[test]
fn test_address_empty_sheet_text() {
    let mut model = new_empty_model();
    // A present-but-empty sheet_text still emits the "!" separator.
    model._set("A1", r#"=ADDRESS(1,1,1,TRUE,"")"#);
    // An omitted sheet_text emits no prefix.
    model._set("A2", "=ADDRESS(1,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "!$A$1");
    assert_eq!(model._get_text("A2"), "$A$1");
}

#[test]
fn test_address_quoted_sheet_text() {
    let mut model = new_empty_model();
    // A name that needs quoting is wrapped in single quotes.
    model._set("A1", r#"=ADDRESS(1,1,1,TRUE,"My Sheet")"#);
    // The maximum column still renders correctly with a sheet prefix.
    model._set("A2", "=ADDRESS(1,16384)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "'My Sheet'!$A$1");
    assert_eq!(model._get_text("A2"), "$XFD$1");
}

// ── AREAS ─────────────────────────────────────────────────────────────────────

#[test]
fn test_areas_single_cell() {
    let mut model = new_empty_model();
    model._set("A1", "=AREAS(B2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
}

#[test]
fn test_areas_range() {
    let mut model = new_empty_model();
    model._set("A1", "=AREAS(B2:D4)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
}
