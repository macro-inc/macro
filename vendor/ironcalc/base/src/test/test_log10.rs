#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=LOG10(100)");
    model._set("A2", "=LOG10()");
    model._set("A3", "=LOG10(100, 10)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

#[test]
fn cell_and_function() {
    let mut model = new_empty_model();
    model._set("A1", "=LOG10");

    model.evaluate();

    // This is the cell LOG10
    assert_eq!(model._get_text("A1"), *"0");

    model._set("LOG10", "1000");
    model._set("A2", "=LOG10(LOG10)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1000");
    assert_eq!(model._get_text("A2"), *"3");
}
