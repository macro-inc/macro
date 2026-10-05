#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn simple_cases() {
    let mut model = new_empty_model();
    model._set("A1", "Well");

    model._set("B1", "=REPT(A1, 3)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"WellWellWell");
}

#[test]
fn wrong_number_of_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "Well");

    model._set("B1", "=REPT(A1)");
    model._set("B2", "=REPT(A1,3,1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}
