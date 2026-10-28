#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=FACT()");
    model._set("A2", "=FACTDOUBLE()");
    model._set("A3", "=FACT(3)");
    model._set("A4", "=FACTDOUBLE(3)");
    model._set("A5", "=FACT(1, 2)");
    model._set("A6", "=FACTDOUBLE(1, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"6");
    assert_eq!(model._get_text("A4"), *"3");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
}
