#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_geomean_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=GEOMEAN()");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
}

#[test]
fn test_fn_geomean_minimal() {
    let mut model = new_empty_model();
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("B4", "'2");
    // B5 is empty
    model._set("B6", "true");
    model._set("A1", "=GEOMEAN(B1:B6)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1.817120593");
}

#[test]
fn test_fn_geomean_zero_value_returns_num_error() {
    let mut model = new_empty_model();
    model._set("A1", "0");
    model._set("A2", "1");
    model._set("A3", "2");
    model._set("B1", "=GEOMEAN(A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#NUM!");
}

#[test]
fn test_fn_geomean_negative_value_returns_num_error() {
    let mut model = new_empty_model();
    model._set("A1", "-1");
    model._set("A2", "1");
    model._set("B1", "=GEOMEAN(A1:A2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#NUM!");
}

#[test]
fn test_fn_geomean_array_literal() {
    let mut model = new_empty_model();
    // Array literal {1,2,3} — previously fell through to the ignored arm
    model._set("A1", "=GEOMEAN({1,2,3})");
    model.evaluate();
    let v: f64 = model._get_text("A1").parse().unwrap();
    assert!((v - 1.817120593).abs() < 1e-7);
}

#[test]
fn test_fn_geomean_large_values_no_overflow() {
    let mut model = new_empty_model();
    // Previously: product = 1e200 * 1e200 = inf → wrong answer
    model._set("A1", "1e200");
    model._set("A2", "1e200");
    model._set("B1", "=GEOMEAN(A1:A2)");
    model.evaluate();
    let v: f64 = model._get_text("B1").parse().unwrap();
    assert!(
        (v - 1e200).abs() < 1e190,
        "GEOMEAN of two 1e200 values should be 1e200, got {v}"
    );
}
