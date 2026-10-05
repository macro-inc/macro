#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn issue_623() {
    let mut model = new_empty_model();
    model._set("A1", "=WORKDAY.INTL(46000, 5, 11, 46001)");
    model._set("A2", "=WORKDAY.INTL(46000, 10, \"1111111\")"); // Weekend mask is all weekends

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"46007");
    assert_eq!(model._get_text("A2"), *"#VALUE!");
}
