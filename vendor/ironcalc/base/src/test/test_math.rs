#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_fn_sqrt_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=SQRT(4)");
    model._set("A2", "=SQRT()");
    model._set("A3", "=SQRT(4, 4)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

#[test]
fn test_fn_sqrtpi_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=SQRTPI()");
    model._set("A2", "=SQRTPI(4, 4)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}
