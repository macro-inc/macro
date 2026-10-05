#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn true_false_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=TRUE( )");
    model._set("A2", "=FALSE( )");
    model._set("A3", "=TRUE( 4 )");
    model._set("A4", "=FALSE( 4 )");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"TRUE");
    assert_eq!(model._get_text("A2"), *"FALSE");

    assert_eq!(model._get_formula("A1"), *"=TRUE()");
    assert_eq!(model._get_formula("A2"), *"=FALSE()");

    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
    assert_eq!(model._get_formula("A3"), *"=TRUE(4)");
    assert_eq!(model._get_formula("A4"), *"=FALSE(4)");
}
