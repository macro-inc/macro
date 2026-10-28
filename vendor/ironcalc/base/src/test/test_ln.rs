#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=LN(100)");
    model._set("A2", "=LN()");
    model._set("A3", "=LN(100, 10)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"4.605170186");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}
