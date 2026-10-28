#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn fn_type_array() {
    let mut model = new_empty_model();
    model._set("A1", "=TYPE()");
    model._set("A2", "=TYPE(A1:C30)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"64");
}
