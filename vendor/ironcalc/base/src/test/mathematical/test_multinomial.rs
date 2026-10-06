#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_multinomial_basic() {
    let mut model = new_empty_model();
    // MULTINOMIAL(2,3,4) = 9! / (2! * 3! * 4!) = 362880 / (2 * 6 * 24) = 362880 / 288 = 1260
    model._set("A1", "=MULTINOMIAL(2,3,4)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1260");
}

#[test]
fn test_multinomial_single() {
    let mut model = new_empty_model();
    // MULTINOMIAL(5) = 5!/5! = 1
    model._set("A1", "=MULTINOMIAL(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
}

#[test]
fn test_multinomial_zeros() {
    let mut model = new_empty_model();
    // MULTINOMIAL(0,0,1) = 1!/1! = 1
    model._set("A1", "=MULTINOMIAL(0,0,1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "1");
}

#[test]
fn test_multinomial_range() {
    let mut model = new_empty_model();
    model._set("A1", "2");
    model._set("A2", "3");
    model._set("A3", "4");
    model._set("B1", "=MULTINOMIAL(A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "1260");
}

#[test]
fn test_multinomial_negative_error() {
    let mut model = new_empty_model();
    model._set("A1", "=MULTINOMIAL(2,-1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#NUM!");
}

#[test]
fn test_multinomial_two_two() {
    let mut model = new_empty_model();
    // MULTINOMIAL(2,2) = 4! / (2! * 2!) = 24 / 4 = 6
    model._set("A1", "=MULTINOMIAL(2,2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "6");
}

#[test]
fn test_multinomial_overflow_num_error() {
    // Inputs large enough that (sum)! overflows f64 → must return #NUM!, not Inf.
    let mut model = new_empty_model();
    model._set("A1", "=MULTINOMIAL(100000,100000)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#NUM!");
}
