#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_sum_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=SUM()");
    model._set("A2", "=SUM(1, 2, 3)");
    model._set("A3", "=SUM(1, )");
    model._set("A4", "=SUM(1,   , 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"6");
    assert_eq!(model._get_text("A3"), *"1");
    assert_eq!(model._get_text("A4"), *"4");
}

#[test]
fn arrays() {
    let mut model = new_empty_model();
    model._set("A1", "=SUM({1, 2, 3})");
    model._set("A2", "=SUM({1; 2; 3})");
    model._set("A3", "=SUM({1, 2; 3, 4})");
    model._set("A4", "=SUM({1, 2; 3, 4; 5, 6})");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"6");
    assert_eq!(model._get_text("A2"), *"6");
    assert_eq!(model._get_text("A3"), *"10");
    assert_eq!(model._get_text("A4"), *"21");
}

#[test]
fn test_fn_sum_text_converted_to_number() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM("1")"#);
    model._set("A2", r#"=SUM("1e2")"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"100");
}

#[test]
fn test_fn_sum_invalid_text() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM("a")"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#VALUE!");
}

#[test]
fn test_fn_sum_text_in_range_not_converted() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM(B1:D1)"#);
    model._set("B1", r#"="100""#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
}

#[test]
fn test_fn_sum_text_in_reference_not_converted() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM(B1)"#);
    model._set("B1", r#"="100""#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
}

#[test]
fn test_fn_sum_text_in_indirect_reference_not_converted() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM(INDIRECT("B1"))"#);
    model._set("B1", r#"="100""#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
}

#[test]
fn test_fn_sum_text_in_indirect_reference() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM(INDIRECT("B1"))"#);
    model._set("B1", r#"100"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"100");
}

#[test]
fn test_fn_sum_invalid_text_in_range() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM(B1:D1)"#);
    model._set("B1", "a");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
}

#[test]
fn test_fn_sum_invalid_text_in_reference() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM(B1)"#);
    model._set("B1", r#"a"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
}

#[test]
fn test_fn_sum_boolean_values_converted() {
    let mut model = new_empty_model();

    model._set("A1", r#"=SUM(TRUE)"#);
    model._set("A2", r#"=SUM(FALSE)"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"0");
}

// ── whole-column range and a spill beyond the used area ─────────────────────

// A whole-column range is clipped to the sheet's used area before it is
// walked. Inside an anchor, the column may be spilled on demand during the
// walk, past the bound the walk was clipped to. The skipped part is on
// record, so the spill restarts the pass and the second run sees it all.
#[test]
fn test_fn_sum_whole_column_sees_a_spill_beyond_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,SUM(D:D))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "15");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 1);

    model.evaluate();
    assert_eq!(model._get_text("A1"), "15");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 0);
}
