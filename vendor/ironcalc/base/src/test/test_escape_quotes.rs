#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn escape_quotes() {
    let mut model = new_empty_model();
    model._set("A1", r#"="TEST""ABC""#);
    model.evaluate();

    assert_eq!(model._get_text("A1"), *r#"TEST"ABC"#);
}
