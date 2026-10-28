#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn issue_155() {
    let mut model = new_empty_model();
    model._set("A1", "123");
    model._set("D2", "=-(A1^1.22)");
    model.evaluate();

    assert_eq!(model._get_formula("D2"), "=-(A1^1.22)".to_string());
}
