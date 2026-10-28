#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_sumproduct_basic() {
    let mut model = new_empty_model();
    // SUMPRODUCT({1,2,3}, {4,5,6}) = 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "4");
    model._set("B2", "5");
    model._set("B3", "6");
    model._set("C1", "=SUMPRODUCT(A1:A3,B1:B3)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "32");
}

#[test]
fn test_sumproduct_single_array() {
    let mut model = new_empty_model();
    // SUMPRODUCT({1,2,3}) = 1+2+3 = 6
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "=SUMPRODUCT(A1:A3)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "6");
}

#[test]
fn test_sumproduct_three_arrays() {
    let mut model = new_empty_model();
    // SUMPRODUCT({1,2}, {3,4}, {5,6}) = 1*3*5 + 2*4*6 = 15 + 48 = 63
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("B1", "3");
    model._set("B2", "4");
    model._set("C1", "5");
    model._set("C2", "6");
    model._set("D1", "=SUMPRODUCT(A1:A2,B1:B2,C1:C2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "63");
}

#[test]
fn test_sumproduct_dimension_mismatch() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("B1", "4");
    model._set("B2", "5");
    model._set("C1", "=SUMPRODUCT(A1:A3,B1:B2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "#VALUE!");
}

#[test]
fn test_sumproduct_ignores_text() {
    let mut model = new_empty_model();
    // Text in one array is treated as 0
    model._set("A1", "2");
    model._set("A2", "hello");
    model._set("B1", "3");
    model._set("B2", "4");
    model._set("C1", "=SUMPRODUCT(A1:A2,B1:B2)");
    model.evaluate();
    // 2*3 + 0*4 = 6
    assert_eq!(model._get_text("C1"), "6");
}

#[test]
fn test_sumproduct_2d() {
    let mut model = new_empty_model();
    // 2x2 arrays
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    model._set("C1", "5");
    model._set("D1", "6");
    model._set("C2", "7");
    model._set("D2", "8");
    model._set("E1", "=SUMPRODUCT(A1:B2,C1:D2)");
    model.evaluate();
    // 1*5 + 2*6 + 3*7 + 4*8 = 5+12+21+32 = 70
    assert_eq!(model._get_text("E1"), "70");
}
