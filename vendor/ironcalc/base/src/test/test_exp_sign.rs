#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=EXP()");
    model._set("A2", "=SIGN()");

    model._set("A3", "=EXP(0)");
    model._set("A4", "=SIGN(-10)");

    model._set("A5", "=EXP(1, 2)");
    model._set("A6", "=SIGN(1, 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");

    assert_eq!(model._get_text("A3"), *"1");
    assert_eq!(model._get_text("A4"), *"-1");

    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
}
