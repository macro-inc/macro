#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn simple_example() {
    let mut model = new_empty_model();

    model._set("A1", "220");
    model._set("B1", "=A1*10%");
    model._set("C1", "=SIN(A1)%");

    model.evaluate();

    assert_eq!(model._get_formula("B1"), *"=A1*10%");
    assert_eq!(model._get_text("B1"), *"22");
    assert_eq!(model._get_formula("C1"), *"=SIN(A1)%");
    assert_eq!(model._get_text("C1"), *"0.000883987");
}
