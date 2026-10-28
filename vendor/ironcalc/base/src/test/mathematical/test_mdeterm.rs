#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_mdeterm_2x2() {
    let mut model = new_empty_model();
    // [1, 2; 3, 4] => det = 1*4 - 2*3 = -2
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "3");
    model._set("B2", "4");
    model._set("C1", "=MDETERM(A1:B2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "-2");
}

#[test]
fn test_mdeterm_3x3() {
    let mut model = new_empty_model();
    // identity matrix => det = 1
    model._set("A1", "1");
    model._set("B1", "0");
    model._set("C1", "0");
    model._set("A2", "0");
    model._set("B2", "1");
    model._set("C2", "0");
    model._set("A3", "0");
    model._set("B3", "0");
    model._set("C3", "1");
    model._set("D1", "=MDETERM(A1:C3)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "1");
}

#[test]
fn test_mdeterm_singular() {
    let mut model = new_empty_model();
    // Singular matrix (row 2 = 2 * row 1) => det = 0
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("A2", "2");
    model._set("B2", "4");
    model._set("C1", "=MDETERM(A1:B2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "0");
}

#[test]
fn test_mdeterm_non_square_error() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "2");
    model._set("C1", "3");
    model._set("A2", "4");
    model._set("B2", "5");
    model._set("C2", "6");
    model._set("D1", "=MDETERM(A1:C2)");
    model.evaluate();
    assert_eq!(model._get_text("D1"), "#VALUE!");
}

#[test]
fn test_mdeterm_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=MDETERM()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#ERROR!");
    model._set("B1", "=MDETERM(1,2)");
    model.evaluate();
    assert_eq!(model._get_text("B1"), "#ERROR!");
}
