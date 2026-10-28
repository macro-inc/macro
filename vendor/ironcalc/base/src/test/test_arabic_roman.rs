#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=ARABIC()");
    model._set("A2", "=ARABIC(\"V\")");
    model._set("A3", "=ARABIC(\"V\", 2)");

    model._set("A4", "=ROMAN()");
    model._set("A5", "=ROMAN(5)");
    model._set("A6", "=ROMAN(5, 0)");
    model._set("A7", "=ROMAN(5, 0, 2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"5");
    assert_eq!(model._get_text("A3"), *"#ERROR!");

    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"V");
    assert_eq!(model._get_text("A6"), *"V");
    assert_eq!(model._get_text("A7"), *"#ERROR!");
}
