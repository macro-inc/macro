#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_arraytotext_concise() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "hello");
    model._set("A2", "2");
    model._set("B2", "world");
    model._set("C1", "=ARRAYTOTEXT(A1:B2)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "1, hello, 2, world");
}

#[test]
fn test_arraytotext_strict() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("B1", "hello");
    model._set("C1", "=ARRAYTOTEXT(A1:B1, 1)");
    model.evaluate();
    assert_eq!(model._get_text("C1"), "{1,\"hello\"}");
}
