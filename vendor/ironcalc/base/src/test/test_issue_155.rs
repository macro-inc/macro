#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn issue_155() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("B2", "=A$1:A2");
    model.evaluate();

    assert_eq!(model._get_formula("B2"), "=A$1:A2".to_string());
}
