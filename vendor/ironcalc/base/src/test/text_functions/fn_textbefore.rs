#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn simple_cases() {
    let mut model = new_empty_model();
    model._set("A1", "Brian Wiles");
    model._set("A2", "Jeden,dwa,trzy,cztery");

    model._set("B1", "=TEXTAFTER(A1, \" \")");
    model._set("B2", "=TEXTAFTER(A2, \",\")");
    model._set("C2", "=TEXTAFTER(A2, \",\", 2)");

    model._set("H1", "=TEXTBEFORE(A1, \" \")");
    model._set("H2", "=TEXTBEFORE(A2, \",\")");
    model._set("I2", "=_xlfn.TEXTBEFORE(A2, \",\", 2)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"Wiles");
    assert_eq!(model._get_text("B2"), *"dwa,trzy,cztery");
    assert_eq!(model._get_text("C2"), *"trzy,cztery");

    assert_eq!(model._get_text("H1"), *"Brian");
    assert_eq!(model._get_text("H2"), *"Jeden");
    assert_eq!(model._get_text("I2"), *"Jeden,dwa");
    assert_eq!(model._get_formula("I2"), *"=TEXTBEFORE(A2,\",\",2)");
}
