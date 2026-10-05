#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_simple_circ() {
    let mut model = new_empty_model();
    model._set("A1", "=A1+1");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#CIRC!");
}

#[test]
fn test_simple_circ_propagate() {
    let mut model = new_empty_model();
    model._set("A1", "=B6");
    model._set("A2", "=A1+1");
    model._set("A3", "=A2+1");
    model._set("A4", "=A3+5");
    model._set("B6", "=A4*7");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "#CIRC!");
    assert_eq!(model._get_text("A2"), "#CIRC!");
    assert_eq!(model._get_text("A3"), "#CIRC!");
    assert_eq!(model._get_text("A4"), "#CIRC!");
    assert_eq!(model._get_text("B6"), "#CIRC!");
}
