#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── INDEX with inline arrays ──────────────────────────────────────────────────

#[test]
fn test_index_array_row_vector() {
    let mut model = new_empty_model();
    // A 1×4 row vector: the single index is a column index -> scalar.
    model._set("A1", "=INDEX({1,2,3,4},2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "2");
}

#[test]
fn test_index_array_column_vector() {
    let mut model = new_empty_model();
    // A 4×1 column vector: the single index is a row index -> scalar.
    model._set("A1", "=INDEX({1;2;3;4},3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
}

#[test]
fn test_index_array_whole_row() {
    let mut model = new_empty_model();
    // A 2×2 array: a single index selects an entire row -> array (spills).
    model._set("A1", "=INDEX({1,2;3,4},1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
}

#[test]
fn test_index_array_whole_row_second() {
    let mut model = new_empty_model();
    model._set("A1", "=INDEX({1,2;3,4},2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "3");
    assert_eq!(model._get_text("B1"), "4");
}

#[test]
fn test_index_array_row_and_col() {
    let mut model = new_empty_model();
    // Both row_num and col_num given -> single cell.
    model._set("A1", "=INDEX({1,2;3,4},1,1)");
    model._set("A2", "=INDEX({1,2;3,4},2,1)");
    model._set("A3", "=INDEX({1,2;3,4},2,2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "3");
    assert_eq!(model._get_text("A3"), "4");
}

#[test]
fn test_index_array_out_of_range() {
    let mut model = new_empty_model();
    model._set("A1", "=INDEX({1,2,3,4},9)");
    model._set("A2", "=INDEX({1,2;3,4},3,1)");
    model._set("A3", "=INDEX({1,2;3,4},1,5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#REF!");
    assert_eq!(model._get_text("A2"), "#REF!");
    assert_eq!(model._get_text("A3"), "#REF!");
}

#[test]
fn test_index_array_strings_and_booleans() {
    let mut model = new_empty_model();
    model._set("A1", "=INDEX({\"a\",\"b\";TRUE,FALSE},2,1)");
    model._set("A2", "=INDEX({\"a\",\"b\";TRUE,FALSE},1,2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "TRUE");
    assert_eq!(model._get_text("A2"), "b");
}

// ── Zero / missing indices select whole rows, columns or the entire array ─────

#[test]
fn test_index_missing_both_returns_whole_array() {
    let mut model = new_empty_model();
    // Missing row and column -> the whole array spills.
    model._set("A1", "=INDEX({1,2,3,4},,)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
    assert_eq!(model._get_text("D1"), "4");
}

#[test]
fn test_index_missing_row_returns_whole_column() {
    let mut model = new_empty_model();
    // Missing row, column 1 -> the whole first column spills down.
    model._set("A1", "=INDEX({1,2;3,4},,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "3");
}

#[test]
fn test_index_zero_row_returns_whole_column() {
    let mut model = new_empty_model();
    // A row index of 0 behaves like a missing row.
    model._set("A1", "=INDEX({1,2,3;4,5,6},0,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "4");
}

#[test]
fn test_index_zero_column_returns_whole_row() {
    let mut model = new_empty_model();
    // A column index of 0 (with the area argument) selects the whole row.
    model._set("A1", "=INDEX({1,2,3},1,0,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
}

#[test]
fn test_index_negative_row_is_value_error() {
    let mut model = new_empty_model();
    model._set("A1", "=INDEX({1,2,3;4,5,6},-1,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

#[test]
fn test_index_area_out_of_range_is_ref_error() {
    let mut model = new_empty_model();
    // Only one area exists, so area_num = 2 is #REF!.
    model._set("A1", "=INDEX({1,2,3},1,0,2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#REF!");
}

#[test]
fn test_index_range_missing_row_spills_column() {
    let mut model = new_empty_model();
    model._set("A1", "10");
    model._set("A2", "20");
    model._set("B1", "30");
    model._set("B2", "40");
    // Missing row, column 2 of A1:B2 -> the whole second column spills.
    model._set("D1", "=INDEX(A1:B2,,2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "30");
    assert_eq!(model._get_text("D2"), "40");
}
