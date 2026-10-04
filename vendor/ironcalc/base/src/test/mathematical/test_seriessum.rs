#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_seriessum_basic() {
    let mut model = new_empty_model();
    // SERIESSUM(2, 1, 1, {1, 2, 3})
    // = 1*2^1 + 2*2^2 + 3*2^3 = 2 + 8 + 24 = 34
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=SERIESSUM(2,1,1,A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "34");
}

#[test]
fn test_seriessum_geometric_series() {
    // Geometric series: SERIESSUM(0.5, 0, 1, {1,1,1,1}) = 1 + 0.5 + 0.25 + 0.125 = 1.875
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "1");
    model._set("A3", "1");
    model._set("A4", "1");
    model._set("B1", "=SERIESSUM(0.5,0,1,A1:A4)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1.875");
}

#[test]
fn test_seriessum_single_coeff() {
    let mut model = new_empty_model();
    // SERIESSUM(3, 2, 0, {5}) = 5 * 3^2 = 45
    model._set("A1", "5");
    model._set("B1", "=SERIESSUM(3,2,0,A1)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "45");
}

#[test]
fn test_seriessum_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=SERIESSUM(1,0,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}

#[test]
fn test_seriessum_x1_n0_m1() {
    let mut model = new_empty_model();
    // SERIESSUM(1, 0, 1, {1, 1, 1}) = 1*1^0 + 1*1^1 + 1*1^2 = 1+1+1 = 3
    model._set("A1", "1");
    model._set("A2", "1");
    model._set("A3", "1");
    model._set("B1", "=SERIESSUM(1,0,1,A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "3");
}

#[test]
fn test_seriessum_negative_base_fractional_exponent_num_error() {
    // x=-2 with fractional exponent 0.5 → NaN → must return #NUM!, not NaN.
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "=SERIESSUM(-2,0.5,1,A1)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#NUM!");
}

#[test]
fn test_seriessum_overflow_num_error() {
    // Very large base and exponent → overflow to Inf → must return #NUM!, not Inf.
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "=SERIESSUM(1E300,1000,1,A1)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#NUM!");
}
