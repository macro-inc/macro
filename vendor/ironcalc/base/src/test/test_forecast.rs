#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_forecast_basic() {
    let mut model = new_empty_model();
    // known_y: 2, 3, 9, 1, 8  known_x: 6, 5, 11, 7, 5  predict at x=8
    model._set("A1", "2");
    model._set("A2", "3");
    model._set("A3", "9");
    model._set("A4", "1");
    model._set("A5", "8");
    model._set("B1", "6");
    model._set("B2", "5");
    model._set("B3", "11");
    model._set("B4", "7");
    model._set("B5", "5");
    model._set("C1", "=FORECAST(8, A1:A5, B1:B5)");
    model.evaluate();
    // slope = (5*173 - 34*23) / (5*256 - 34^2) = 83/124
    // intercept = (23 - (83/124)*34) / 5 ≈ 0.04839
    // FORECAST(8) ≈ 0.04839 + (83/124)*8 ≈ 5.40323
    let result = model._get_text("C1");
    let v: f64 = result.parse().unwrap();
    assert!(
        (v - 5.40323).abs() < 0.001,
        "FORECAST result {v} not close to expected 5.40323"
    );
}

#[test]
fn test_forecast_perfect_line() {
    let mut model = new_empty_model();
    // y = 2x + 1
    model._set("A1", "3");
    model._set("A2", "5");
    model._set("A3", "7");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("C1", "=FORECAST(4, A1:A3, B1:B3)");
    model.evaluate();
    let result = model._get_text("C1");
    let v: f64 = result.parse().unwrap();
    assert!(
        (v - 9.0).abs() < 1e-10,
        "FORECAST(4) on y=2x+1 should be 9, got {v}"
    );
}

#[test]
fn test_forecast_linear_identical_to_forecast() {
    let mut model = new_empty_model();
    model._set("A1", "3");
    model._set("A2", "5");
    model._set("A3", "7");
    model._set("B1", "1");
    model._set("B2", "2");
    model._set("B3", "3");
    model._set("C1", "=FORECAST(4, A1:A3, B1:B3)");
    model._set("C2", "=FORECAST.LINEAR(4, A1:A3, B1:B3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), model._get_text("C2"));
}

#[test]
fn test_forecast_constant_x_returns_div_error() {
    let mut model = new_empty_model();
    // All x values the same -> division by zero
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "5");
    model._set("B2", "5");
    model._set("B3", "5");
    model._set("C1", "=FORECAST(5, A1:A3, B1:B3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#DIV/0!");
}

#[test]
fn test_forecast_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=FORECAST(1, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
}
