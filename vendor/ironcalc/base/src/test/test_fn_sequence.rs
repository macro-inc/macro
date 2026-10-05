#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_sequence_basic() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "2");
    assert_eq!(model._get_text("A3"), "3");
}

#[test]
fn test_sequence_rows_cols() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(2,3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("C1"), "3");
    assert_eq!(model._get_text("A2"), "4");
    assert_eq!(model._get_text("B2"), "5");
    assert_eq!(model._get_text("C2"), "6");
}

#[test]
fn test_sequence_start_step() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(4,1,10,5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "15");
    assert_eq!(model._get_text("A3"), "20");
    assert_eq!(model._get_text("A4"), "25");
}

#[test]
fn test_sequence_negative_step() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3,1,10,-1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "9");
    assert_eq!(model._get_text("A3"), "8");
}

#[test]
fn test_sequence_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");

    model._set("B1", "=SEQUENCE(1,1,1,1,1)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#ERROR!");
}

#[test]
fn test_sequence_invalid_rows() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#CALC!");
}

#[test]
fn test_sequence_rows_exceeds_sheet_limit() {
    // LAST_ROW is 1_048_576; one beyond that must return #VALUE!
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1048577)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

#[test]
fn test_sequence_cols_exceeds_sheet_limit() {
    // LAST_COLUMN is 16_384; one beyond that must return #VALUE!
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,16385)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#VALUE!");
}

#[test]
fn test_sequence_rows_cols_exceeds_max_size() {
    // If rows * columns exceeds MAX_SIZE (1_000_000), must return #ERROR!
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1000,1001)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}

#[test]
fn test_sequence_omit_rows() {
    // =SEQUENCE(,12,,2.5) — rows omitted (default 1), cols=12, start omitted (default 1), step=2.5
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(,12,,2.5)");
    model.evaluate();
    // 1 row × 12 columns: 1, 3.5, 6, 8.5, 11, 13.5, 16, 18.5, 21, 23.5, 26, 28.5
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("B1"), "3.5");
    assert_eq!(model._get_text("C1"), "6");
    assert_eq!(model._get_text("L1"), "28.5");
    // No second row
    assert_eq!(model._get_text("A2"), "");
    // No 13th column
    assert_eq!(model._get_text("M1"), "");
}

#[test]
fn test_sequence_omit_cols() {
    // =SEQUENCE(3,,10) — cols omitted (default 1), start=10, step omitted (default 1)
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3,,10)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10");
    assert_eq!(model._get_text("A2"), "11");
    assert_eq!(model._get_text("A3"), "12");
    assert_eq!(model._get_text("B1"), "");
    assert_eq!(model._get_text("A4"), "");
}

#[test]
fn test_sequence_omit_start() {
    // =SEQUENCE(3,1,,5) — start omitted (default 1), step=5
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(3,1,,5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
    assert_eq!(model._get_text("A2"), "6");
    assert_eq!(model._get_text("A3"), "11");
}
