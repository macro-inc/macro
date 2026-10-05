#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=COMBIN(5,2)");
    model._set("A2", "=COMBINA(5,2)");
    model._set("A3", "=COMBIN()");
    model._set("A4", "=COMBINA()");
    model._set("A5", "=COMBIN(2)");
    model._set("A6", "=COMBINA(2)");
    model._set("A7", "=COMBIN(1, 2, 3)");
    model._set("A8", "=COMBINA(1, 2, 3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"10");
    assert_eq!(model._get_text("A2"), *"15");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
    assert_eq!(model._get_text("A7"), *"#ERROR!");
    assert_eq!(model._get_text("A8"), *"#ERROR!");
}
