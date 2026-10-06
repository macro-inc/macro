#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=LOG(100)");
    model._set("A2", "=LOG()");
    model._set("A3", "=LOG(10000, 10)");
    model._set("A4", "=LOG(100, 10, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"4");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}
