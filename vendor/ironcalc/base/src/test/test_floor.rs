#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_floor_floating_point_precision() {
    // This test specifically checks the floating-point precision bug fix
    // Bug: FLOOR(7.1, 0.1) was returning 7.0 instead of 7.1
    let mut model = new_empty_model();

    // FLOOR tests
    model._set("C5", "=FLOOR(7.1, 0.1)");
    model._set("H7", "=FLOOR(-7.1, -0.1)");

    // FLOOR.PRECISE tests
    model._set("C53", "=FLOOR.PRECISE(7.1, 0.1)");
    model._set("H53", "=FLOOR.PRECISE(7.1, -0.1)");

    // FLOOR.MATH tests
    model._set("C101", "=FLOOR.MATH(7.1, 0.1)");
    model._set("H101", "=FLOOR.MATH(7.1, -0.1)");

    model.evaluate();

    // All should return 7.1
    assert_eq!(model._get_text("C5"), *"7.1");
    assert_eq!(model._get_text("H7"), *"-7.1");
    assert_eq!(model._get_text("C53"), *"7.1");
    assert_eq!(model._get_text("H53"), *"7.1");
    assert_eq!(model._get_text("C101"), *"7.1");
    assert_eq!(model._get_text("H101"), *"7.1");
}

#[test]
fn test_floor_additional_precision_cases() {
    let mut model = new_empty_model();
    model._set("A1", "=FLOOR(7.9, 0.1)");
    model._set("A2", "=FLOOR(2.6, 0.5)");
    model._set("A3", "=FLOOR(0.3, 0.1)"); // 0.1 + 0.2 type scenario

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"7.9");
    assert_eq!(model._get_text("A2"), *"2.5");
    assert_eq!(model._get_text("A3"), *"0.3");
}

#[test]
fn test_floor_basic_cases() {
    let mut model = new_empty_model();
    model._set("A1", "=FLOOR(3.7, 2)");
    model._set("A2", "=FLOOR(3.2, 1)");
    model._set("A3", "=FLOOR(10, 3)");
    model._set("A4", "=FLOOR(7, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A2"), *"3");
    assert_eq!(model._get_text("A3"), *"9");
    assert_eq!(model._get_text("A4"), *"6");
}

#[test]
fn test_floor_negative_numbers() {
    let mut model = new_empty_model();
    // Both negative: rounds toward zero
    model._set("A1", "=FLOOR(-2.5, -2)");
    model._set("A2", "=FLOOR(-11, -3)");

    // Negative number, positive significance: rounds away from zero
    model._set("A3", "=FLOOR(-11, 3)");
    model._set("A4", "=FLOOR(-2.5, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"-2");
    assert_eq!(model._get_text("A2"), *"-9");
    assert_eq!(model._get_text("A3"), *"-12");
    assert_eq!(model._get_text("A4"), *"-4");
}

#[test]
fn test_floor_error_cases() {
    let mut model = new_empty_model();
    // Positive number with negative significance should error
    model._set("A1", "=FLOOR(2.5, -2)");
    model._set("A2", "=FLOOR(10, -3)");

    // Division by zero
    model._set("A3", "=FLOOR(5, 0)");

    // Wrong number of arguments
    model._set("A4", "=FLOOR(5)");
    model._set("A5", "=FLOOR(5, 1, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
    assert_eq!(model._get_text("A3"), *"#DIV/0!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
}

#[test]
fn test_floor_edge_cases() {
    let mut model = new_empty_model();
    // Zero value
    model._set("A1", "=FLOOR(0, 5)");
    model._set("A2", "=FLOOR(0, 0)");

    // Exact multiples
    model._set("A3", "=FLOOR(10, 5)");
    model._set("A4", "=FLOOR(9, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"0");
    assert_eq!(model._get_text("A2"), *"0");
    assert_eq!(model._get_text("A3"), *"10");
    assert_eq!(model._get_text("A4"), *"9");
}
