#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=MOD(5,2)");
    model._set("A2", "=MOD()");
    model._set("A3", "=MOD(5, 2, 1)");
    model._set("A4", "=QUOTIENT(5, 2)");
    model._set("A5", "=QUOTIENT()");
    model._set("A6", "=QUOTIENT(5, 2, 1)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"2");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
}
