#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_degrees_radians_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=DEGREES()");
    model._set("A2", "=RADIANS()");
    model._set("A3", "=RADIANS(180)");
    model._set("A4", "=RADIANS(180, 2)");
    model._set("A5", "=DEGREES(RADIANS(180))");
    model._set("A6", "=DEGREES(1, 2)");
    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"3.141592654");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"180");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
}
